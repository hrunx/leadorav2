## Leadora – Production‑grade multi‑agent lead generation (GPT‑5 + Jobs + Embeddings)

This system discovers and maps ideal customers/suppliers, enriches decision makers, and generates investor‑grade market insights. It’s fully serverless (Netlify Functions), type‑safe (TS + Zod), resilient (jobs + fallbacks), and fast (embedding‑first mapping).

### Architecture v2 (high‑level)
- Frontend: Vite + React + TypeScript + Tailwind
- Backend: Netlify Functions (TypeScript), scheduled worker for jobs
- Agents/LLMs: OpenAI GPT‑5 family (primary), Gemini 2.0 Flash (fallback), DeepSeek (fallback)
- Data: Supabase (DB + Realtime)
- Discovery: Serper (Search/Places), fallbacks to Google CSE and Google Places
- Validation: Zod schemas + OpenAI Structured Outputs (JSON Schema)

### Execution model
1) Start: `/.netlify/functions/orchestrator-start` triggers `orchestrator-run-background`.
2) Orchestration: `src/orchestration/orchestrate.ts` launches 4 agents (parallel):
   - Business Personas (3)
   - DM Personas (3)
   - Business Discovery (Places→insert)
   - Market Research (TAM/SAM/SOM + citations)
3) Fast inserts only: Agents/tools insert minimal rows and enqueue heavy work (no long tool calls).
4) Jobs drain: Scheduled worker `jobs-dispatcher` claims and processes work (every minute).
5) Live progress: `/.netlify/functions/check-progress` + Supabase Realtime update the UI.

### Jobs (durable background tasks)
Table: `public.jobs` with `claim_job/complete_job/fail_job/heartbeat_job` RPCs
- `persona_mapping` — maps businesses and decision makers to personas
- `dm_discovery_batch` — finds LinkedIn profiles via Serper for new businesses
- `compute_business_embeddings` — embeds `businesses` rows
- `compute_bp_embeddings` — embeds `business_personas` rows
- `compute_dm_persona_embeddings` — embeds `decision_maker_personas` rows
- `compute_dm_embeddings` — embeds `decision_makers` rows

Worker: `/.netlify/functions/jobs-dispatcher` (see netlify.toml ‘scheduled.functions’)
Debug: `/.netlify/functions/check-jobs?search_id=…`

### Embedding‑first persona mapping
- Columns: `business_personas.embedding`, `decision_maker_personas.embedding`, `businesses.embedding`, `decision_makers.embedding` (pgvector)
- RPCs: `set_*_embedding` for each table
- Match RPCs: `match_business_best_persona(business_id)`, `match_dm_top2_personas(dm_id)`
- Algorithm:
  - Business→Persona: pick best cosine match; fallback to LLM/heuristics if vectors missing.
  - DM→Persona: pick top vector match; if top‑2 within ε=0.03, refine with LLM; else accept best.

### LLM policy & structured outputs
- Primary: GPT‑5 (`resolveModel('primary'|'light'|'ultraLight')`)
- Fallbacks: Gemini 2.0 Flash → DeepSeek
- Structured Outputs: Business Personas, DM Personas, Market Research use JSON Schema (zod‑to‑json‑schema) with GPT‑5 Responses API.

### Discovery and fallbacks
- Serper Places/Search (primary)
  - Places fallback: Google Places (v1 API, then legacy TextSearch + Details)
  - Search fallback: Google CSE; returns empty result gracefully if blocked
- Response cache tracks source as `serper`, `google_places`, or `google_cse`.

### Key files
- Orchestrator (Agent): `src/agents/orchestrator.agent.ts`
- Orchestration logic: `src/orchestration/orchestrate.ts`
- Business personas: `src/agents/business-persona.agent.ts`
- DM personas: `src/agents/dm-persona.agent.ts`
- Business discovery: `src/agents/business-discovery.agent.ts`
- DM discovery (per business): `src/agents/dm-discovery-individual.agent.ts`
- Market research: `src/agents/market-research.agent.ts`
- Persona mapping: `src/tools/persona-mapper.ts`
- Serper client: `src/tools/serper.ts`
- Jobs worker: `netlify/functions/jobs-dispatcher.ts`, handlers `src/jobs/handlers.ts`

### Environment variables (server + browser)
- Supabase
  - `SUPABASE_URL` / `VITE_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` / `VITE_SUPABASE_SERVICE_ROLE_KEY` (server)
  - `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` (browser)
- OpenAI
  - `OPENAI_API_KEY` (required)
  - `OPENAI_PRIMARY_MODEL` (`gpt-5`), `OPENAI_LIGHT_MODEL` (`gpt-5-mini`), `OPENAI_ULTRA_LIGHT_MODEL` (`gpt-5-nano`)
  - `OPENAI_MAX_CONCURRENT` (e.g., `2`), `OPENAI_MIN_DELAY_MS` (e.g., `300`)
  - `OPENAI_EMBEDDINGS_MODEL` (default `text-embedding-3-small`)
- Gemini: `GEMINI_API_KEY`
- DeepSeek: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-chat`)
- Serper: `SERPER_KEY` / `VITE_SERPER_KEY`
- Google Places: `GOOGLE_PLACES_KEY` / `VITE_GOOGLE_PLACES_KEY` (server/browser)
- Google CSE: `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` or `GOOGLE_SEARCH_ENGINE_ID` (also accepts `Google_CSE_CX` if present)
- Optional: `LINKEDIN_MAX_EMPLOYEES_PER_COMPANY`, `CAN_SPEND`, `DEBUG_COUNTRY_MAPPING`

> Provide both `VITE_*` and non‑prefixed variants where used on both client and server.

### Local dev
1) `npm ci`
2) `npm run dev` (Vite + Netlify Functions)
3) Typecheck + lint: `npm run typecheck` + `npm run lint -- --fix`

### Operations
- Inspect jobs: `/.netlify/functions/check-jobs`
- Monitor API usage: rows in `api_usage_logs` (tokens always, cost optional)
- Tune rate limits: `OPENAI_MAX_CONCURRENT`, `OPENAI_MIN_DELAY_MS`
- Migrations: run `schema.jobs-and-embeddings.sql` on Supabase once

### Security & privacy
- No secrets in client bundles; writes only from Netlify functions
- Centralized structured logging; zero `console.*` in production paths

— Built for speed, signal, and sales outcomes.
