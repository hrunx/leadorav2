import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('respondJSON', () => {
  const schema = z.object({ a: z.string(), n: z.number() });

  beforeEach(() => {
    // ensure api key present for OpenAI client init
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  });

  it('parses valid JSON and validates via Zod', async () => {
    const client = await import('./responsesClient');
    // @ts-expect-error override for test
    client.openai.responses.create = vi.fn(async (_req: any) => {
      return { output_text: JSON.stringify({ a: 'ok', n: 42 }) } as any;
    });
    const res = await client.respondJSON({ system: 'sys', user: 'user', schema });
    expect(res).toEqual({ a: 'ok', n: 42 });
  });

  it('throws when schema does not match', async () => {
    const client = await import('./responsesClient');
    // @ts-expect-error override for test
    client.openai.responses.create = vi.fn(async (_req: any) => {
      return { output_text: JSON.stringify({ a: 'ok', n: 'bad' }) } as any;
    });
    await expect(client.respondJSON({ system: 'sys', user: 'user', schema })).rejects.toBeTruthy();
  });
});
