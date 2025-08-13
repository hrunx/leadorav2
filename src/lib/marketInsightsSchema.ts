import { z } from 'zod';

export const MarketSizeSchema = z.object({
  value: z.string(),
  growth: z.string().optional(),
  description: z.string(),
  calculation: z.string().optional(),
  source: z.string().url().optional(),
  data_quality: z.string().optional(),
}).strict().catchall(z.any());

export const CompetitorSchema = z.object({
  name: z.string(),
  marketShare: z.union([z.string(), z.number()]).optional(),
  revenue: z.string().optional(),
  growth: z.string().optional(),
  notes: z.string().optional(),
  description: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  source: z.string().url().optional(),
}).strict().catchall(z.any());

export const TrendSchema = z.object({
  trend: z.string().optional(),
  title: z.string().optional(),
  impact: z.string().optional(),
  growth: z.string().optional(),
  description: z.string().optional(),
  timeline: z.string().optional(),
  source: z.string().url().optional(),
}).strict().catchall(z.any());

const OpportunityObjectSchema = z.object({
  summary: z.string(),
  playbook: z.array(z.string()),
  market_gaps: z.array(z.string()),
  timing: z.string(),
}).strict();

const OpportunityItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  potential: z.string(),
  timeframe: z.string(),
}).strict();

export const OpportunitiesSchema = z.union([
  OpportunityObjectSchema,
  z.array(OpportunityItemSchema),
]);

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  date: z.string().optional(),
  used_for: z.array(z.string()).optional(),
}).strict().catchall(z.any());

export const MarketInsightsSchema = z.object({
  tam_data: MarketSizeSchema,
  sam_data: MarketSizeSchema,
  som_data: MarketSizeSchema,
  competitor_data: z.array(CompetitorSchema),
  trends: z.array(TrendSchema),
  opportunities: OpportunitiesSchema,
  sources: z.array(SourceSchema).optional(),
  analysis_summary: z.string().optional(),
  research_methodology: z.string().optional(),
});

export type MarketInsights = z.infer<typeof MarketInsightsSchema>;

export const MarketInsightsInsertSchema = MarketInsightsSchema.extend({
  search_id: z.string(),
  user_id: z.string(),
});
