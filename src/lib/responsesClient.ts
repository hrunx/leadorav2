import OpenAI from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { limits, withLimit } from './limiters';
import { withRetry } from './retry';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function respondJSON<T extends z.ZodTypeAny>(opts: {
  model?: string; system: string; user: string; schema: T; temperature?: number;
}): Promise<z.infer<T>> {
  const jsonSchema = zodToJsonSchema(opts.schema, 'Out');
  const model = opts.model ?? process.env.OPENAI_PRIMARY_MODEL ?? 'gpt-5';
  const callResponses = async () => {
    const r = await openai.responses.create({
      model,
      input: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'Out', schema: jsonSchema, strict: true }
      },
      temperature: opts.temperature ?? 0.2
    } as any);
    const text = (r as any).output_text ?? ((r as any).output && JSON.stringify((r as any).output)) ?? '{}';
    return JSON.parse(String(text || '{}'));
  };
  const callCompletions = async () => {
    const r = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.2
    } as any);
    const text = (r as any).choices?.[0]?.message?.content || '{}';
    return JSON.parse(String(text || '{}'));
  };
  try {
    const json = await withLimit(limits.openai, () => withRetry('openai.responses.json', callResponses));
    return opts.schema.parse(json);
  } catch (e: any) {
    // Fallback to Chat Completions JSON object mode
    const json = await withLimit(limits.openai, () => withRetry('openai.chat.json', callCompletions));
    return opts.schema.parse(json);
  }
}
