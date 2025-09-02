import { z } from 'zod';

export const Persona = z.object({
  title: z.string(),
  description: z.string().min(10),
  company_size: z.enum(['Small','Mid','Enterprise']),
  decision_criteria: z.array(z.string()).min(3)
});

export const PersonasOut = z.object({ personas: z.array(Persona).length(3) });

