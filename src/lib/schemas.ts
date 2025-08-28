import { z } from 'zod';

// Business persona (Zod) for structured outputs
export const ZBusinessPersona = z.object({
  title: z.string(),
  rank: z.number().int().min(1).max(5),
  match_score: z.number().int().min(60).max(100),
  demographics: z.object({
    industry: z.string(),
    companySize: z.string(),
    geography: z.string(),
    revenue: z.string()
  }).strict(),
  characteristics: z.object({
    painPoints: z.array(z.string()).min(1),
    motivations: z.array(z.string()).min(1),
    challenges: z.array(z.string()).min(1),
    decisionFactors: z.array(z.string()).min(1)
  }).strict(),
  behaviors: z.object({
    buyingProcess: z.string(),
    decisionTimeline: z.string(),
    budgetRange: z.string(),
    preferredChannels: z.array(z.string()).min(1)
  }).strict(),
  market_potential: z.object({
    totalCompanies: z.number().positive(),
    avgDealSize: z.string(),
    conversionRate: z.number().positive()
  }).strict(),
  locations: z.array(z.string()).min(1)
}).strict();

export const ZBusinessPersonasPayload = z.object({
  personas: z.array(ZBusinessPersona).min(3).max(3)
}).strict();

// Decision maker persona (Zod)
export const ZDMPersona = z.object({
  title: z.string(),
  rank: z.number().int().min(1).max(5),
  match_score: z.number().int().min(60).max(100),
  demographics: z.object({
    level: z.string(),
    department: z.string(),
    experience: z.string(),
    geography: z.string()
  }).strict(),
  characteristics: z.object({
    responsibilities: z.array(z.string()).min(1),
    painPoints: z.array(z.string()).min(1),
    motivations: z.array(z.string()).min(1),
    challenges: z.array(z.string()).min(1),
    decisionFactors: z.array(z.string()).min(1)
  }).strict(),
  behaviors: z.object({
    decisionMaking: z.string(),
    communicationStyle: z.string(),
    buyingProcess: z.string(),
    preferredChannels: z.array(z.string()).min(1)
  }).strict(),
  market_potential: z.object({
    totalDecisionMakers: z.number().positive(),
    avgInfluence: z.number().positive(),
    conversionRate: z.number().positive()
  }).strict()
}).strict();

export const ZDMPersonasPayload = z.object({
  personas: z.array(ZDMPersona).min(3).max(3)
}).strict();

