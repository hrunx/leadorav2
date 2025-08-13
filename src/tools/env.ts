const REQUIRED_ENV_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY'
] as const;

type EnvKey = typeof REQUIRED_ENV_VARS[number];

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && (process as any)?.env?.[key]) {
    return (process as any).env[key];
  }
  try {
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Validate that all required environment variables are present.
 * Throws an error listing missing keys to prevent partial runtime failures.
 */
export function validateEnv(keys: EnvKey[] = REQUIRED_ENV_VARS as unknown as EnvKey[]): void {
  const missing = keys.filter(key => {
    const value = readEnv(key);
    return value === undefined || String(value).trim() === '';
  });
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export default validateEnv;
