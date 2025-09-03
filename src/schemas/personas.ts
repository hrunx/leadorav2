import { z } from 'zod';

// Legacy minimal schema used for generic persona drafts (kept for back-compat tests)
export const Persona = z.object({
  title: z.string(),
  description: z.string().min(10),
  company_size: z.enum(['Small','Mid','Enterprise']),
  decision_criteria: z.array(z.string()).min(3)
});

export const PersonasOut = z.object({ personas: z.array(Persona).length(3) });

// New strict schema for business personas tailored to UI needs
export const BusinessPersonaStrict = z.object({
  title: z.string().min(3),
  rank: z.number().int().min(1).max(5),
  match_score: z.number().int().min(1).max(100),
  demographics: z.object({
    industry: z.string().min(2),
    companySize: z.string().min(1),
    geography: z.string().min(2),
    revenue: z.string().min(1)
  }),
  characteristics: z.object({
    painPoints: z.array(z.string().min(2)).min(2),
    motivations: z.array(z.string().min(2)).min(2),
    challenges: z.array(z.string().min(2)).min(1),
    decisionFactors: z.array(z.string().min(2)).min(2)
  }),
  behaviors: z.object({
    buyingProcess: z.string().min(2),
    decisionTimeline: z.string().min(2),
    budgetRange: z.string().min(1),
    preferredChannels: z.array(z.string().min(2)).min(1)
  }),
  market_potential: z.object({
    totalCompanies: z.number().int().min(1),
    avgDealSize: z.string().min(1),
    conversionRate: z.number().min(0.1)
  }),
  locations: z.array(z.string().min(2)).min(1)
});

export const BusinessPersonasOut = z.object({ personas: z.array(BusinessPersonaStrict).length(3) });

// Strict DM persona schema aligned with UI fields
export const DMPersonaStrict = z.object({
  title: z.string().min(3),
  rank: z.number().int().min(1).max(5),
  match_score: z.number().int().min(1).max(100),
  demographics: z.object({
    level: z.string().min(2),
    department: z.string().min(2),
    experience: z.string().min(1),
    geography: z.string().min(2)
  }),
  characteristics: z.object({
    responsibilities: z.array(z.string().min(2)).min(2),
    painPoints: z.array(z.string().min(2)).min(2),
    motivations: z.array(z.string().min(2)).min(2),
    challenges: z.array(z.string().min(2)).min(1),
    decisionFactors: z.array(z.string().min(2)).min(2)
  }),
  behaviors: z.object({
    decisionMaking: z.string().min(2),
    communicationStyle: z.string().min(2),
    buyingProcess: z.string().min(2),
    preferredChannels: z.array(z.string().min(2)).min(1)
  }),
  market_potential: z.object({
    totalDecisionMakers: z.number().int().min(1),
    avgInfluence: z.string().min(1),
    conversionRate: z.string().min(1)
  })
});

export const DMPersonasOut = z.object({ personas: z.array(DMPersonaStrict).length(3) });

