import { createClient } from '@supabase/supabase-js';

  // WARNING: This module must be used from Netlify functions/server only
let _supaRead: ReturnType<typeof createClient> | null = null;
const getSupabaseClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('db.read.ts must not be imported/used in the browser');
  }
  if (_supaRead) return _supaRead;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL) throw new Error('supabaseUrl is required. Set SUPABASE_URL or VITE_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabaseKey is required. Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  _supaRead = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _supaRead;
};

export const loadSearch = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('user_searches').select('*').eq('id', search_id).single();
  if (error) throw error; 
  return data;
};

export const loadBusinessPersonas = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('business_personas').select('id,title,rank').eq('search_id', search_id).order('rank',{ascending:true});
  if (error) throw error; 
  return data||[];
};

export const loadDMPersonas = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('decision_maker_personas').select('id,title,rank,match_score,demographics,characteristics,behaviors,market_potential,search_id,user_id').eq('search_id', search_id).order('rank',{ascending:true});
  if (error) throw error; 
  return data||[];
};

export const loadBusinesses = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('businesses').select('id,name,description,country,city,address,phone,website,rating').eq('search_id', search_id);
  if (error) throw error;
  return data||[];
};

export const loadPersonaCache = async (cache_key: string) => {
  const supa = getSupabaseClient();
  try {
    const { data, error } = await supa
      .from('persona_cache')
      .select('personas')
      .eq('cache_key', cache_key)
      .maybeSingle();
    if (error) throw error;
    return (data as any)?.personas || null;
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if ((e && (e.code === '42P01')) || /does not exist/i.test(msg)) {
      // persona_cache table missing; treat cache as miss
      return null;
    }
    throw e;
  }
};