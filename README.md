## Leadora – The first commercial multi‑agent, product/service‑specific lead generation platform (GPT‑5 powered)

Leadora is a production‑grade, zero‑console, fully serverless multi‑agent system that discovers ideal customer profiles, maps decision makers, enriches contacts, and generates investor‑grade market insights for any product or service.

### Why this is one‑of‑a‑kind
- Multi‑agent orchestration runs all discovery and analysis agents in parallel for speed and resilience.
- Product/service‑specific personas and decision‑maker mapping tailor the entire pipeline to your GTM.
- Market research agent produces structured TAM/SAM/SOM, competitive landscape, and trends—ready for pitch decks.
- Robust fallbacks and caching keep results flowing even under API limits (Serper → Google CSE fallback, in‑memory and DB cache).
- Strict zero‑console policy; safe, redactable structured logging only, keeping production noise and PII out of logs.

### Core features
- Business Personas (3) and Decision‑Maker Personas (3) generated instantly for your product/service and target industries.
- Business Discovery (Serper Places/Search + CSE fallback), country‑aware, with conservative filtering.
- Decision‑Maker Discovery + server‑side Contact Enrichment (email/phone) with graceful backoff.
- Market Research (GPT‑5 primary) with multi‑country web references, structured JSON output (TAM/SAM/SOM, competitors, trends).
- Optional advanced market research with live web search and TAM/SAM/SOM, competitor, and trend analysis when `use_advanced_research` is set on a search record.
- Real‑time UI progress via SSE and Supabase listeners; data persists in Supabase (RLS compatible).

### Architecture
- Frontend: Vite + React + TypeScript + Tailwind
- Backend: Netlify Functions (TypeScript)
- Agents/LLMs: GPT‑5 (primary), Gemini 2.0, DeepSeek (optional)
- Data: Supabase (DB + Realtime)
- Discovery: Serper API (Google Places/Search) with Google CSE fallback

#### Orchestration flow
1) `orchestrator-start` triggers background `orchestrator-run-background`.
2) `src/orchestration/orchestrate.ts` launches 4 agents in parallel:
   - Business Personas
   - Decision‑Maker Personas
   - Business Discovery
   - Market Research
3) `check-progress` reports phase and percentage; UI subscribes to realtime inserts.
4) `user-data-proxy` provides safe browser → DB access for read flows (RLS‑aware) and smooth CORS.

### Concurrency & Backoff
- `storeBusinesses` limits instant decision‑maker lookups to batches of **3** with a **500 ms** pause between batches.
- Peak throughput is roughly **6 businesses/second**, easing pressure on external APIs.
- Any businesses that fail individual processing fall back to the slower bulk discovery, which already spaces requests.

### What we implemented in this version
- Zero‑console policy across the entire app and all functions; centralized logger emits no runtime console.
- Serper client hardened (timeouts, backoff, DB cache, CSE fallback), with country‑aware filtering and KSA/ZA mapping fixes.
- Persona mapper fully typed; best‑match persona selection with strict parsing and safer scoring.
- Realtime/search services unified: proper Authorization headers, proxy fallback, cache scoping, error headers.
- Orchestrator parallelization and progress updates; robust error handling and completion semantics.
- Market Research JSON extraction with fallback to structured parsing when AI returns free text.
- Contact enrichment gated server‑side only; no secrets shipped to the client.
- All lint, typecheck, and production build steps green; bundle kept within reasonable size with clear chunking guidance.

### Quick start (local)
1) Install deps
```bash
npm ci
```
2) Run dev with Netlify functions
```bash
npm run dev
```
3) Lint & Type Check
```bash
npm run lint -- --fix
npm run typecheck
```

### Environment variables

| Name | Required | Usage |
|------|----------|-------|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | ✅ | Supabase project URL (browser & server). |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | ✅ (browser) | Public anon key for client-side reads. |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ (server) | Service-role key for Netlify Functions writes. |
| `SERPER_KEY` | ✅ | Google Serper API for business & DM discovery. |
| `OPENAI_API_KEY` | ⚠️ Required for all OpenAI-based agents. |
| `OPENAI_PRIMARY_MODEL` | optional | Overrides default `gpt-4o` for heavy tasks (e.g. `gpt-5`). |
| `OPENAI_LIGHT_MODEL` | optional | Light-weight model (default `gpt-4o`). |
| `OPENAI_ULTRA_LIGHT_MODEL` | optional | Ultra-light model for quick tools. |
| `OPENAI_MAX_CONCURRENT` | optional | Global concurrency limit (default **2**). |
| `OPENAI_MIN_DELAY_MS` | optional | Minimum ms between calls (default **300**). |
| `GEMINI_API_KEY` | optional | Enables Gemini-based market-research fallback. |
| `DEEPSEEK_API_KEY` | optional | Enables DeepSeek generation tools. |
| `DEEPSEEK_MODEL` | optional | Default DeepSeek model id (default `deepseek-chat`). |
| `VITE_GOOGLE_PLACES_KEY` / `GOOGLE_PLACES_KEY` | optional | Google Places fallback when Serper quota exceeded. |
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` / `GOOGLE_SEARCH_ENGINE_ID` | optional | Google Custom Search fallback. |
| `EMAIL_API_URL` | optional | Outbound OTP/email micro-service endpoint. |
| `EMAIL_API_KEY` | optional | API key for the above service. |
| `LINKEDIN_MAX_EMPLOYEES_PER_COMPANY` | optional | Cap DMs stored per company (default **5**). |
| `CAN_SPEND` | optional | If set to `true`, allows paid API usage paths. |
| `DEBUG_COUNTRY_MAPPING` | optional | Logs country→GL mapping decisions. |

> **Tip:** Provide both the `VITE_*` **and** non-prefixed variants when possible to cover browser and Netlify-function environments gracefully.

### Key Netlify Functions
- Start orchestration: `/.netlify/functions/orchestrator-start`
- Background runner: `/.netlify/functions/orchestrator-run-background`
- Progress: `/.netlify/functions/check-progress`
- API usage logs: `/.netlify/functions/check-api-logs`
- Read proxy (RLS‑aware): `/.netlify/functions/user-data-proxy`
- Enrichment (server‑side only): `/.netlify/functions/enrich-decision-makers`
- Test suite: `/.netlify/functions/test-*`

### Database (Supabase)
- Canonical SQLs: `complete_database_setup_fixed.sql`, `fix_authentication_and_database.sql`, `fix_proxy_authentication.sql`, `fix_rls_policies.sql`.
- RLS policies support read flows via proxy; server functions use service role for writes.
- `market_insights.sources` now stores objects `{ title, url, date }` for richer citation metadata.

### Security & privacy
- No secrets in client bundles; write operations occur only in functions.
- Logger removes console output entirely; PII redaction preserved for future external logging sinks.

### Troubleshooting
- UI idle? Realtime fallback triggers polling every 5s.
- Serper quota/auth? Google CSE fallback auto‑engages when keys provided.
- Country mapping: “SA” reserved for Saudi Arabia (sa). Use “ZA”/“South Africa” for South Africa.

### Roadmap
- Advanced deduping/merge strategies across multiple discovery sources.
- Configurable heuristics for company size/revenue by industry/region.
- Slack/Email alerts when new ICP matches appear.

— Built for speed, signal, and sales outcomes.
