import objectHash from 'object-hash';
import { supaServer } from './supaServer';

export const makeKey = (scope: string, data: unknown) => `${scope}:${objectHash(data, { unorderedArrays: true })}`;

export async function remember<T>(key: string, ttlSec: number, calc: () => Promise<T>): Promise<T> {
  const supa = supaServer();
  const { data } = await supa
    .from('idempotency_cache')
    .select('payload, ttl_at')
    .eq('key', key)
    .maybeSingle();
  if (data && new Date((data as any).ttl_at).getTime() > Date.now()) return (data as any).payload as T;
  const payload = await calc();
  await supa.from('idempotency_cache').upsert({ key, payload, ttl_at: new Date(Date.now() + ttlSec * 1000).toISOString() });
  return payload;
}

