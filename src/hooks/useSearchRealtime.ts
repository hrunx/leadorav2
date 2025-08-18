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
        const base = '/.netlify/functions/user-data-proxy';
        const headers = { Accept: 'application/json' } as const;
        const [bp, dmp, b, dm, us] = await Promise.all([
          fetch(`${base}?table=business_personas&search_id=${searchId}`, { headers }).then(r => r.ok ? r.json() : [] as any[]).catch(() => []),
          fetch(`${base}?table=decision_maker_personas&search_id=${searchId}`, { headers }).then(r => r.ok ? r.json() : [] as any[]).catch(() => []),
          fetch(`${base}?table=businesses&search_id=${searchId}`, { headers }).then(r => r.ok ? r.json() : [] as any[]).catch(() => []),
          fetch(`${base}?table=decision_makers&search_id=${searchId}`, { headers }).then(r => r.ok ? r.json() : [] as any[]).catch(() => []),
          fetch(`${base}?table=user_searches&search_id=${searchId}`, { headers }).then(r => r.ok ? r.json() : [] as any[]).catch(() => []),
        ]);
        const userSearch = Array.isArray(us) && us.length ? us[0] : {};
        setBusinessPersonas(Array.isArray(bp) ? bp : []);
        setDmPersonas(Array.isArray(dmp) ? dmp : []);
        setBusinesses(Array.isArray(b) ? b : []);
        setDecisionMakers(Array.isArray(dm) ? dm : []);
        setProgress({ phase: userSearch?.phase || 'starting', progress_pct: userSearch?.progress_pct || 0, decision_makers_count: Array.isArray(dm) ? dm.length : 0 });
      } catch {
      } finally {
        setIsLoading(false);
      }
    }

    void initialLoad();

    const dmCountRef = { current: 0 } as { current: number };
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
      dmCountRef.current += (payload.eventType === 'INSERT' ? 1 : 0);
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'user_searches', filter: `id=eq.${searchId}` }, (payload) => {
      const row = payload.new as AnyRow;
      setProgress({ phase: row?.phase || 'starting', progress_pct: row?.progress_pct || 0, decision_makers_count: dmCountRef.current });
    }).subscribe());

    return () => {
      try { channel.unsubscribe(); } catch {}
      subs.forEach(s => { try { s.unsubscribe(); } catch {} });
    };
  }, [searchId]);

  const getDecisionMakersForPersona = useMemo(() => (personaId: string) => decisionMakers.filter(dm => dm.persona_id === personaId), [decisionMakers]);

  // No-op: hook exposes state and selector via memo; subscriptions live in the first effect

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


