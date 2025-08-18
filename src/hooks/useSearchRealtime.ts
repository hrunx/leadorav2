import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type AnyRow = Record<string, any>;

export function useSearchRealtime(searchId: string | null) {
  const [businessPersonas, setBusinessPersonas] = useState<AnyRow[]>([]);
  const [dmPersonas, setDmPersonas] = useState<AnyRow[]>([]);
  const [businesses, setBusinesses] = useState<AnyRow[]>([]);
  const [decisionMakers, setDecisionMakers] = useState<AnyRow[]>([]);
  const [progress, setProgress] = useState<{ phase: string; progress_pct?: number; decision_makers_count?: number }>({ phase: 'starting' });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const initialized = useRef(false);

  useEffect(() => {
    if (!searchId) return;
    setIsLoading(true);
    initialized.current = true;
    const subs: Array<{ unsubscribe: () => void }> = [] as any;

    async function initialLoad() {
      try {
        const [bp, dmp, b, dm, us] = await Promise.all([
          supabase.from('business_personas').select('*').eq('search_id', searchId),
          supabase.from('decision_maker_personas').select('*').eq('search_id', searchId),
          supabase.from('businesses').select('*').eq('search_id', searchId),
          supabase.from('decision_makers').select('*').eq('search_id', searchId),
          supabase.from('user_searches').select('phase,progress_pct').eq('id', searchId).single(),
        ]);
        setBusinessPersonas(Array.isArray(bp.data) ? bp.data : []);
        setDmPersonas(Array.isArray(dmp.data) ? dmp.data : []);
        setBusinesses(Array.isArray(b.data) ? b.data : []);
        setDecisionMakers(Array.isArray(dm.data) ? dm.data : []);
        setProgress({ phase: (us.data as any)?.phase || 'starting', progress_pct: (us.data as any)?.progress_pct || 0, decision_makers_count: (Array.isArray(dm.data) ? dm.data.length : 0) });
      } catch {
      } finally {
        setIsLoading(false);
      }
    }

    void initialLoad();

    const channel = supabase.channel(`search-${searchId}`);
    subs.push(channel.on('postgres_changes', { event: '*', schema: 'public', table: 'business_personas', filter: `search_id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setBusinessPersonas((prev) => payload.eventType === 'DELETE' ? prev.filter(x => x.id !== payload.old?.id) : (prev.some(x => x.id === row.id) ? prev : [...prev, row]));
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'decision_maker_personas', filter: `search_id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setDmPersonas((prev) => payload.eventType === 'DELETE' ? prev.filter(x => x.id !== payload.old?.id) : (prev.some(x => x.id === row.id) ? prev : [...prev, row]));
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'businesses', filter: `search_id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setBusinesses((prev) => payload.eventType === 'DELETE' ? prev.filter(x => x.id !== payload.old?.id) : (prev.some(x => x.id === row.id) ? prev : [...prev, row]));
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'decision_makers', filter: `search_id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setDecisionMakers((prev) => payload.eventType === 'DELETE' ? prev.filter(x => x.id !== payload.old?.id) : (prev.some(x => x.id === row.id) ? prev : [...prev, row]));
      setProgress((prev) => ({ ...prev, decision_makers_count: (prev.decision_makers_count || 0) + (payload.eventType === 'INSERT' ? 1 : 0) }));
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'user_searches', filter: `id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setProgress({ phase: row?.phase || 'starting', progress_pct: row?.progress_pct || 0, decision_makers_count: (decisionMakers?.length || 0) });
    }).subscribe());

    return () => {
      try { channel.unsubscribe(); } catch {}
      subs.forEach(s => { try { s.unsubscribe(); } catch {} });
    };
  }, [searchId]);

  const getDecisionMakersForPersona = useMemo(() => (personaId: string) => decisionMakers.filter(dm => dm.persona_id === personaId), [decisionMakers]);

  return {
    isLoading: isLoading && !initialized.current,
    businessPersonas,
    dmPersonas,
    businesses,
    decisionMakers,
    getDecisionMakersForPersona,
    progress,
  } as const;
}


