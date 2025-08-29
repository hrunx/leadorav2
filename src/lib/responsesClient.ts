import OpenAI from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { limits, withLimit } from './limiters';
import { withRetry } from './retry';
import logger from './logger';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function respondJSON<T extends z.ZodTypeAny>(opts: {
  model?: string; system: string; user: string; schema: T; temperature?: number;
}): Promise<z.infer<T>> {
  const jsonSchema = zodToJsonSchema(opts.schema, 'Out');
  const model = opts.model ?? process.env.OPENAI_PRIMARY_MODEL ?? 'gpt-5';
  const callResponses = async () => {
    logger.info('[OPENAI] responses.create start', { model, temperature: opts.temperature ?? 0.2 });
    const r = await openai.responses.create({
      model,
      input: [
        { role: 'system', content: `${opts.system}\nReturn ONLY JSON. No explanations.` },
        { role: 'user', content: opts.user }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'Out',
          schema: jsonSchema as any,
          strict: true
        }
      },
      temperature: opts.temperature ?? 0.2
    } as any);
    const text = (r as any).output_text ?? ((r as any).output && JSON.stringify((r as any).output)) ?? '{}';
    logger.info('[OPENAI] responses.create ok', { bytes: String(text || '').length });
    return JSON.parse(String(text || '{}'));
  };
  const callCompletions = async () => {
    logger.info('[OPENAI] chat.completions.create fallback start', { model });
    const r = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `${opts.system}\nALWAYS return a single JSON object. No explanations.` },
        { role: 'user', content: `Schema (JSON Schema named Out): ${JSON.stringify(jsonSchema)}\n\nUser Input:\n${opts.user}\n\nReturn ONLY JSON.` }
      ],
      response_format: { type: 'json_object' }
    } as any);
    const text = (r as any).choices?.[0]?.message?.content || '{}';
    logger.info('[OPENAI] chat.completions.create ok', { bytes: String(text || '').length });
    return JSON.parse(String(text || '{}'));
  };
  try {
    const json = await withLimit(limits.openai, () => withRetry('openai.responses.json', callResponses));
    return opts.schema.parse(json);
  } catch (e: any) {
    logger.warn('[OPENAI] responses.create failed, using chat fallback', { error: e?.message || e });
    try {
      const json = await withLimit(limits.openai, () => withRetry('openai.chat.json', callCompletions));
      return opts.schema.parse(json);
    } catch (e2: any) {
      logger.error('[OPENAI] chat.completions fallback failed', { error: e2?.message || e2 });
      throw e2;
    }
  }
}
