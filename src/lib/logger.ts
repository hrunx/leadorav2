type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function readEnv(key: string): string | undefined {
  // Server (Node/Netlify functions)
  if (typeof process !== 'undefined' && (process as any).env) {
    const v = (process as any).env[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  // Browser (Vite/ESM)
  try {
    const viteEnv = (import.meta as any)?.env || (import.meta as any)?.VITE_ENV || undefined;
    const v = viteEnv?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  } catch {}
  return undefined;
}

const nodeEnv = readEnv('NODE_ENV') || readEnv('MODE') || readEnv('VITE_NODE_ENV') || 'development';
const envLevel = (readEnv('LOG_LEVEL') as LogLevel) || (readEnv('VITE_LOG_LEVEL') as LogLevel) || (nodeEnv === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[envLevel];
}

function redactPII(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  let out = input;
  // redact emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  // redact UUIDs
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[redacted-uuid]');
  return out;
}

function emit(level: LogLevel, args: unknown[]) {
  if (!shouldLog(level)) return;
  const safeArgs = args.map(redactPII);
  const prefix = `[${level.toUpperCase()}]`;
  if ((console as any)[level]) {
    (console as any)[level](prefix, ...safeArgs);
  } else {
    console.log(prefix, ...safeArgs);
  }
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args)
};

export default logger;


