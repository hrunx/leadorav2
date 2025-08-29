import { openai } from './responsesClient';

export async function embed(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    input: text
  } as any);
  return (r as any).data[0].embedding as number[];
}

