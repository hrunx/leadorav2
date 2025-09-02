import pRetry, { AbortError } from 'p-retry';

export async function withRetry<T>(name: string, fn: () => Promise<T>, retries = 4) {
  return pRetry(fn, {
    retries,
    factor: 2,
    minTimeout: 400,
    maxTimeout: 4000,
    randomize: true,
    onFailedAttempt: (e: any) => {
      try { console.warn(JSON.stringify({ level: 'warn', op: name, attempt: e.attemptNumber, retriesLeft: e.retriesLeft, msg: String(e.message).slice(0, 200) })); } catch {}
    }
  });
}

export const abortRetry = (msg: string) => { throw new AbortError(msg); };

export { AbortError };
