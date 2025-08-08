import OpenAI from 'openai';
import { setDefaultOpenAIClient } from '@openai/agents';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Orchestration (OpenAI Mini for planning)
ensureEnv(['OPENAI_API_KEY','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY','VITE_SUPABASE_ANON_KEY']);
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
setDefaultOpenAIClient(openai);

// Content generation (unchanged)
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com/v1',
});

export const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { 
    auth: { 
      autoRefreshToken: false, 
      persistSession: false,
      storageKey: 'agents-auth' // Different storage key to avoid conflicts
    } 
  }
);

export const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

function ensureEnv(keys: string[]) {
  const missing = keys.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Centralized model routing with GPT‑5 preference
export const modelRouter = {
  primary(): string {
    return (
      process.env.OPENAI_PRIMARY_MODEL ||
      process.env.OPENAI_DEFAULT_MODEL ||
      'gpt-5'
    );
  },
  light(): string {
    return (
      process.env.OPENAI_LIGHT_MODEL ||
      'gpt-5-mini'
    );
  },
  ultraLight(): string {
    return (
      process.env.OPENAI_ULTRA_LIGHT_MODEL ||
      'gpt-5-nano'
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
  const res = await openai.chat.completions.create(payload);
  return (res.choices?.[0]?.message?.content || '').trim();
}

export async function callGeminiText(modelId: string, prompt: string): Promise<string> {
  const model = gemini.getGenerativeModel({ model: modelId });
  const r = await model.generateContent([{ text: prompt }]);
  return (r.response.text() || '').trim();
}

export async function callDeepseekChatJSON(params: {
  model?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await deepseek.chat.completions.create({
    model: params.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages: [{ role: 'user', content: params.user }],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
  });
  return (res.choices?.[0]?.message?.content || '').trim();
}