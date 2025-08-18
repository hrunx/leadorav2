import OpenAI from 'openai';
import logger from '../lib/logger';
import { setDefaultOpenAIClient } from '@openai/agents';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Resolve envs with server-friendly fallbacks
function getEnv(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value === 'string' && value.trim() !== '') return value;
  return undefined;
}

function requireOneOf(keys: string[]): string {
  for (const k of keys) {
    const v = getEnv(k);
    if (v) return v;
  }
  throw new Error(`Missing required environment variables: one of ${keys.join(' or ')}`);
}

// Orchestration (OpenAI Mini for planning)
ensureEnv(['OPENAI_API_KEY']); // Gemini no longer mandatory
// Validate DeepSeek API key if DeepSeek usage is enabled in code paths
if (process.env.DEEPSEEK_API_KEY === undefined || String(process.env.DEEPSEEK_API_KEY).trim() === '') {
  logger.warn('DEEPSEEK_API_KEY is not set. DeepSeek calls will fail if invoked.');
}
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
// Bridge type mismatch between openai and agents-openai by casting
setDefaultOpenAIClient(openai as unknown as any);

// --- Global OpenAI rate limiter (applies to both direct calls and Agents SDK) ---
const OPENAI_MAX_CONCURRENT = Math.max(1, Number(process.env.OPENAI_MAX_CONCURRENT || 2));
const OPENAI_MIN_DELAY_MS = Math.max(0, Number(process.env.OPENAI_MIN_DELAY_MS || 300));
let openAiRunning = 0;
const openAiQueue: Array<() => void> = [];
let lastOpenAiCallAt = 0;

async function withOpenAiLimiter<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const runNext = async () => {
      openAiRunning++;
      try {
        const since = Date.now() - lastOpenAiCallAt;
        const wait = OPENAI_MIN_DELAY_MS > since ? (OPENAI_MIN_DELAY_MS - since) : 0;
        if (wait > 0) await new Promise(r => setTimeout(r, wait + Math.floor(Math.random() * 50)));
        const result = await fn();
        resolve(result);
      } catch (e) {
        reject(e as any);
      } finally {
        lastOpenAiCallAt = Date.now();
        openAiRunning--;
        const next = openAiQueue.shift();
        if (next) next();
      }
    };
    if (openAiRunning < OPENAI_MAX_CONCURRENT) runNext(); else openAiQueue.push(runNext);
  });
}

// Monkey-patch the OpenAI client to route chat completions through the limiter
try {
  const rawChatCreate: (...args: any[]) => Promise<any> = (openai.chat.completions as any).create.bind(openai.chat.completions);
  (openai.chat.completions as any).create = async (...args: any[]) => {
    const tupleArgs = args as [any, any?];
    return withOpenAiLimiter(() => rawChatCreate(...tupleArgs));
  };
} catch {}

try {
  const rawRespCreate: (...args: any[]) => Promise<any> = (openai.responses as any).create.bind(openai.responses);
  (openai.responses as any).create = async (...args: any[]) => {
    const tupleArgs = args as [any, any?];
    return withOpenAiLimiter(() => rawRespCreate(...tupleArgs));
  };
} catch {}

// Content generation (unchanged)
export const deepseek: OpenAI | null = (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim() !== '')
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY!, baseURL: 'https://api.deepseek.com/v1' })
  : null;

const SUPABASE_URL = requireOneOf(['SUPABASE_URL','VITE_SUPABASE_URL']);
const SUPABASE_SERVICE_ROLE_KEY = requireOneOf(['SUPABASE_SERVICE_ROLE_KEY','VITE_SUPABASE_SERVICE_ROLE_KEY']);
export const supa = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      storageKey: 'agents-auth'
    }
  }
);

export const gemini = (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '')
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  : new GoogleGenerativeAI(''); // Safe placeholder; callers should guard

function ensureEnv(keys: string[]) {
  const missing = keys.filter(k => !getEnv(k));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Centralized model routing with fast, cost-effective models for persona generation
export const modelRouter = {
  primary(): string {
    return (
      process.env.OPENAI_PRIMARY_MODEL ||
      process.env.OPENAI_DEFAULT_MODEL ||
      'gpt-4o-mini'  // Changed to gpt-4o-mini as primary for speed and cost
    );
  },
  light(): string {
    return (
      process.env.OPENAI_LIGHT_MODEL ||
      'gpt-4o-mini'  // Fast model for persona generation
    );
  },
  ultraLight(): string {
    return (
      process.env.OPENAI_ULTRA_LIGHT_MODEL ||
      'gpt-4o-mini'  // Ultra fast for simple tasks
    );
  }
};

export type ModelTier = 'primary' | 'light' | 'ultraLight';
export function resolveModel(tier: ModelTier = 'primary'): string {
  if (tier === 'light') return modelRouter.light();
  if (tier === 'ultraLight') return modelRouter.ultraLight();
  return modelRouter.primary();
}

// Helpers for unified chat calls
export async function callOpenAIChatJSON(params: {
  model: string;
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  requireJsonObject?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  retries?: number;
}): Promise<string> {
  const payload: any = {
    model: params.model,
    messages: [
      params.system ? { role: 'system', content: params.system } : undefined,
      { role: 'user', content: params.user }
    ].filter(Boolean),
  };
  const isGpt5 = /^gpt-5/i.test(params.model);
  if (!isGpt5 && typeof params.temperature === 'number') {
    payload.temperature = params.temperature;
  }
  if (typeof params.maxTokens === 'number') {
    if (isGpt5) {
      payload.max_completion_tokens = params.maxTokens;
    } else {
      payload.max_tokens = params.maxTokens;
    }
  }
  // GPT‑5 structured output and verbosity controls
  if (isGpt5 && params.requireJsonObject) {
    payload.response_format = { type: 'json_object' };
  }
  if (isGpt5 && params.verbosity) {
    payload.verbosity = params.verbosity;
  }
  const doCall = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs || 0);
    try {
      const res = await withOpenAiLimiter(() => openai.chat.completions.create(payload as any, { signal: controller.signal as any }));
      return (res.choices?.[0]?.message?.content || '').trim();
    } finally {
      clearTimeout(t);
    }
  };
  const maxRetries = params.retries ?? 0;
  let attempt = 0;
  // simple linear retry
  while (true) {
    try {
      return await doCall();
    } catch (e) {
      attempt++;
      if (attempt > maxRetries) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

export async function callGeminiText(modelId: string, prompt: string, timeoutMs = 0, retries = 0): Promise<string> {
  const model = gemini.getGenerativeModel({ model: modelId });
  const doCall = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs || 0);
    try {
      const r = await model.generateContent([{ text: prompt }] as any);
      return (r.response.text() || '').trim();
    } finally {
      clearTimeout(t);
    }
  };
  let attempt = 0;
  while (true) {
    try {
      return await doCall();
    } catch (e) {
      attempt++;
      if (attempt > retries) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

export async function callDeepseekChatJSON(params: {
  model?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
}): Promise<string> {
  if (!process.env.DEEPSEEK_API_KEY || !deepseek) {
    throw new Error('DeepSeek not configured');
  }
  const doCall = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs || 0);
    try {
      const res = await deepseek.chat.completions.create({
        model: params.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: params.user }],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      } as any, { signal: controller.signal as any });
      return (res.choices?.[0]?.message?.content || '').trim();
    } finally {
      clearTimeout(t);
    }
  };
  const maxRetries = params.retries ?? 0;
  let attempt = 0;
  while (true) {
    try {
      return await doCall();
    } catch (e) {
      attempt++;
      if (attempt > maxRetries) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}