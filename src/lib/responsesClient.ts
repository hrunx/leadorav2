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
  // Build JSON Schema with inlined refs to avoid Responses API $ref component resolution
  const jsonSchemaDoc = zodToJsonSchema(opts.schema, { name: 'Out', $refStrategy: 'none' } as any) as any;
  // Prefer inlined shape if available; otherwise extract Out
  const extracted = (jsonSchemaDoc?.definitions?.Out) || (jsonSchemaDoc?.$defs?.Out) || jsonSchemaDoc;
  const responsesSchema = (extracted?.type === 'object')
    ? extracted
    : { type: 'object', properties: extracted?.properties || {}, required: extracted?.required || [] } as any;
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
          schema: responsesSchema,
          strict: true
        }
      },
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
        { role: 'user', content: `json schema (name: Out): ${JSON.stringify(responsesSchema)}\n\nuser input:\n${opts.user}\n\nReply with a single JSON object.` }
      ],
      response_format: { type: 'json_object' }
    } as any);
    const text = (r as any).choices?.[0]?.message?.content || '{}';
    logger.info('[OPENAI] chat.completions.create ok', { bytes: String(text || '').length });
    return JSON.parse(String(text || '{}'));
  };
  let json: unknown;
  try {
    json = await withLimit(limits.openai, () => withRetry('openai.responses.json', callResponses));
  } catch (e: any) {
    logger.warn('[OPENAI] responses.create failed, using chat fallback', { error: e?.message || e });
    try {
      json = await withLimit(limits.openai, () => withRetry('openai.chat.json', callCompletions));
    } catch (e2: any) {
      logger.error('[OPENAI] chat.completions fallback failed', { error: e2?.message || e2 });
      throw e2;
    }
  }
  return opts.schema.parse(json);
}
