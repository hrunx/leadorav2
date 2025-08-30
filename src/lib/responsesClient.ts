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
  const jsonSchema = zodToJsonSchema(opts.schema, 'Out') as any;
  const objectSchema = (jsonSchema?.definitions?.Out) || (jsonSchema?.$defs?.Out) || jsonSchema;
  const model = opts.model ?? process.env.OPENAI_PRIMARY_MODEL ?? 'gpt-5';
  const callResponses = async () => {
    logger.info('[OPENAI] responses.create start', { model, temperature: opts.temperature ?? 0.2 });
    const r = await openai.responses.create({
      model,
      input: [
        { role: 'system', content: `${opts.system}\nReturn ONLY valid JSON. No explanations.` },
        { role: 'user', content: `${opts.user}\n\nReply with a single JSON object.` }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'Out',
          schema: objectSchema,
          strict: true
        }
      },
      // Omit temperature for GPT‑5 to avoid 400 'Only default (1) supported'
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
        { role: 'system', content: `${opts.system}\nReturn ONLY valid JSON object. No explanations.` },
        { role: 'user', content: `json schema (name: Out): ${JSON.stringify(objectSchema)}\n\nuser input:\n${opts.user}\n\nReply with a single JSON object.` }
      ],
      response_format: { type: 'json_object' }
    } as any);
    const text = (r as any).choices?.[0]?.message?.content || '{}';
    logger.info('[OPENAI] chat.completions.create ok', { bytes: String(text || '').length });
    return JSON.parse(String(text || '{}'));
  };
  try {
    const json = await withLimit(limits.openai, () => withRetry('openai.responses.json', callResponses));
    // If schema parsing fails, do NOT fallback; surface the validation error immediately
    return opts.schema.parse(json);
  } catch (e: any) {
    // Only fallback to chat if the error is not a Zod validation error
    if (e && (e.name === 'ZodError' || (e.issues && Array.isArray(e.issues)))) {
      logger.error('[OPENAI] responses.parse failed (no fallback)', { error: e?.message || e, issues: e?.issues });
      throw e;
    }
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
