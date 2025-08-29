## Leadora – Production‑grade multi‑agent lead generation (GPT‑5 + Jobs + Embeddings)

This system discovers and maps ideal customers/suppliers, enriches decision makers, and generates investor‑grade market insights. It’s fully serverless (Netlify Functions), type‑safe (TS + Zod), resilient (jobs + fallbacks), and fast (embedding‑first mapping).

### Architecture v2 (high‑level)
- Frontend: Vite + React + TypeScript + Tailwind
- Backend: Netlify Functions (TypeScript)
  - Sequential background pipeline: `orchestrator-run-background`
  - Scheduled workers: `jobs-dispatcher` (queue), `jobs-sweeper` (maintenance)
- LLMs: OpenAI GPT‑5 family (primary via Responses), Gemini 2.0 Flash (fallback), DeepSeek (fallback)
- Data: Supabase (DB + Realtime + pgvector)
- Discovery: Serper (Places/Search) with Google Places/CSE fallbacks and DB cache
- Validation: Zod schemas + OpenAI Responses JSON Schema (strict)

### Execution model (sequential + durable)
1) Trigger: POST `/.netlify/functions/orchestrator-run-background` with `{ search_id, user_id }`
2) Background pipeline runs phases in order (each durable via `job_tasks`):
   - personas → discovery → dm_enrichment → market_research
3) Each phase writes results + progress; pipeline can resume after crash.
4) Jobs queue continues to handle embeddings/mapping and other async tasks.
5) Progress polling: GET `/.netlify/functions/check-progress?search_id=...` (weighted % + per‑phase status)

### Jobs (durable background tasks)
Table: `public.jobs` with `claim_job/complete_job/fail_job/heartbeat_job` RPCs
- `persona_mapping` — maps businesses and decision makers to personas
- `dm_discovery_batch` — finds LinkedIn profiles via Serper for new businesses
- `compute_business_embeddings` — embeds `businesses` rows
- `compute_bp_embeddings` — embeds `business_personas` rows
- `compute_dm_persona_embeddings` — embeds `decision_maker_personas` rows
- `compute_dm_embeddings` — embeds `decision_makers` rows

Worker: `/.netlify/functions/jobs-dispatcher` (see netlify.toml ‘scheduled.functions’)
Sweeper: `/.netlify/functions/jobs-sweeper` (purges cache, requeues stuck tasks)
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
- Pipeline entry: `netlify/functions/orchestrator-run-background.ts`
- Stages: `src/stages/01-personas.ts`, `02-discovery.ts`, `03-dm-enrichment.ts`, `04-market.ts`
- Responses client: `src/lib/responsesClient.ts`
- Schemas: `src/schemas/personas.ts`, `src/schemas/market.ts`
- Limits/Retry/Idempotency: `src/lib/limiters.ts`, `src/lib/retry.ts`, `src/lib/idempotency.ts`
- Embeddings: `src/lib/embeddings.ts`
- Jobs worker: `netlify/functions/jobs-dispatcher.ts`, handlers `src/jobs/handlers.ts`
- Progress endpoints: `netlify/functions/check-progress.ts`, `check-jobs.ts`

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
1) Install deps: `npm ci`
2) Apply SQL in Supabase:
   - `schema.jobs-and-embeddings.sql`
   - `schema.sequential-pipeline.sql` (adds idempotency index, vector indexes, dedupe, RPCs)
3) Set environment variables (Netlify → Site → Env, and `.env` for local)
4) Start dev: `npm run dev`
5) Trigger background run:
   - `curl -XPOST http://localhost:8888/.netlify/functions/orchestrator-run-background -H 'Content-Type: application/json' -d '{"search_id":"<uuid>","user_id":"<uuid>"}'`
6) Poll progress:
   - `curl 'http://localhost:8888/.netlify/functions/check-progress?search_id=<uuid>'`
7) Build: `npm run build` (checks bundling)

### Operations
- Inspect jobs: `/.netlify/functions/check-jobs`
- Check pipeline progress: `/.netlify/functions/check-progress?search_id=…`
- Monitor API usage: rows in `api_usage_logs` (tokens always, cost optional)
- Tune rate limits: `OPENAI_MAX_CONCURRENT`, `OPENAI_MIN_DELAY_MS`
- Migrations: run `schema.jobs-and-embeddings.sql` on Supabase; apply indexes from `schema.md` as needed

### Security & privacy
- No secrets in client bundles; writes only from Netlify functions
- Centralized structured logging; zero `console.*` in production paths

— Built for speed, signal, and sales outcomes.
