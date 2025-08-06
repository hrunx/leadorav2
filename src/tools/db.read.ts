import { createClient } from '@supabase/supabase-js';

// Create a dedicated client for database operations that works in both browser and Netlify functions
const getSupabaseClient = () => {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { 
      auth: { 
        autoRefreshToken: false, 
        persistSession: false
      } 
    }
  );
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
  const { data, error } = await supa.from('decision_maker_personas').select('id,title,rank').eq('search_id', search_id).order('rank',{ascending:true});
  if (error) throw error; 
  return data||[];
};

export const loadBusinesses = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('businesses').select('id,name,description,country,city,address,phone,website,rating').eq('search_id', search_id);
  if (error) throw error; 
  return data||[];
};