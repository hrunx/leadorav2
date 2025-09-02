import { z } from 'zod';

// Avoid z.string().url() because it converts to JSON Schema format "uri",
// which the OpenAI Responses API rejects. Use a permissive http(s) pattern instead.
const HttpUrl = z.string().regex(/^https?:\/\/[^\s]+$/i, 'Invalid URL');

const Source = z.object({ title: z.string(), url: HttpUrl, date: z.string() });

// Use $ref-stable, shared schema objects to avoid nested $ref resolution errors
export const Market = z.object({
  tam: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }).describe('TAM block'),
  sam: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }).describe('SAM block'),
  som: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }).describe('SOM block'),
  competitors: z.array(z.object({
    name: z.string(),
    metric: z.string(),
    // Make all properties required to satisfy OpenAI Responses strict schema
    notes: z.string(),
    sources: z.array(Source).min(1)
  })).min(3),
  trends: z.array(z.object({ statement: z.string(), confidence: z.enum(['low','medium','high']), horizon_years: z.number() })).min(3),
  methodology: z.string(),
  assumptions: z.array(z.string()).min(3)
});

