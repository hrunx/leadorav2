import { z } from 'zod';

const Source = z.object({ title: z.string(), url: z.string().url(), date: z.string() });

export const Market = z.object({
  tam: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }),
  sam: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }),
  som: z.object({ value: z.string(), method: z.string(), sources: z.array(Source).min(2) }),
  competitors: z.array(z.object({
    name: z.string(),
    metric: z.string(),
    notes: z.string().optional(),
    sources: z.array(Source).min(1)
  })).min(3),
  trends: z.array(z.object({ statement: z.string(), confidence: z.enum(['low','medium','high']), horizon_years: z.number() })).min(3),
  methodology: z.string(),
  assumptions: z.array(z.string()).min(3)
});

