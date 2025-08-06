import OpenAI from 'openai';
import { setDefaultOpenAIClient } from '@openai/agents';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Orchestration (OpenAI Mini for planning)
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