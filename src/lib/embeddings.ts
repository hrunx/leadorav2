import { openai } from './responsesClient';
import logger from './logger';

export async function embed(text: string): Promise<number[]> {
  logger.info('[OPENAI] embeddings.create start', { model: process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small', bytes: text.length });
  const r = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    input: text
  } as any);
  const emb = (r as any).data[0].embedding as number[];
  logger.info('[OPENAI] embeddings.create ok', { dim: Array.isArray(emb) ? emb.length : 0 });
  return emb;
}

