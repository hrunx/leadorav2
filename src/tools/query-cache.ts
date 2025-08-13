import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';

// Lazy Supabase client for server-side use only
let _supa: ReturnType<typeof createClient> | null = null;
function getSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('query-cache.ts must not be imported/used in the browser');
  }
  if (_supa) return _supa;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL) throw new Error('supabaseUrl is required. Set SUPABASE_URL or VITE_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabaseKey is required. Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  _supa = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _supa;
}

const TABLE = 'query_cache';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const makeKey = (company: string, query: string) => `${company}::${query}`.toLowerCase();

export async function hasSeenQuery(company: string, query: string): Promise<boolean> {
  const supa = getSupabaseClient();
  const key = makeKey(company, query);
  const { data, error } = await supa.from(TABLE).select('key').eq('key', key).limit(1);
  if (error) {
    logger.warn('query-cache hasSeenQuery failed', { error: error.message || error });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function markSeenQuery(company: string, query: string): Promise<void> {
  const supa = getSupabaseClient();
  const key = makeKey(company, query);
  const now = new Date().toISOString();
  const { error } = await supa.from(TABLE).upsert({ key, created_at: now }, { onConflict: 'key' });
  if (error) {
    logger.warn('query-cache markSeenQuery failed', { error: error.message || error });
  }
  try {
    await cleanupOldEntries();
  } catch (e: any) {
    logger.warn('query-cache cleanup failed', { error: e?.message || e });
  }
}

export async function cleanupOldEntries(): Promise<void> {
  const supa = getSupabaseClient();
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  const { error } = await supa.from(TABLE).delete().lt('created_at', cutoff);
  if (error) {
    logger.warn('query-cache cleanup delete failed', { error: error.message || error });
    throw error;
  }
}

