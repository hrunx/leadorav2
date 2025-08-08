## Leadora – Progressive Lead Generation (Dev Guide)

### Overview
Leadora runs multi-agent lead generation with progressive UI updates:
- Business personas (3) and DM personas (3) appear fast.
- Business discovery (5 places) and DM discovery run in the background.
- Market research runs in parallel and uses DB cache of personas/companies/DMs.
- All data persists in Supabase; Netlify Functions power all backend steps.

### Tech Stack
- Frontend: Vite + React + TypeScript + Tailwind
- Realtime: Supabase subscriptions + polling fallback
- Backend: Netlify Functions (TypeScript)
- Agents/LLMs: OpenAI GPT‑5 (nano/mini), Gemini 2.0 Flash, DeepSeek
- External: Serper API (Google Places/Search)

### Quick Start
1) Install deps
```
npm ci
```
2) Dev server (Netlify dev with functions proxy)
```
npm run dev
```
3) Lint & Type Check
```
npm run lint -- --fix
npx tsc -p tsconfig.json --noEmit
```

### Required Env Vars
Set in Netlify/CI or local `.env` (do not commit secrets):
- VITE_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- GEMINI_API_KEY
- DEEPSEEK_API_KEY
- SERPER_KEY
- Optional: GOOGLE_CSE_KEY, GOOGLE_CSE_CX (fallback search)
- Optional model overrides:
  - OPENAI_PRIMARY_MODEL (default: gpt-5)
  - OPENAI_LIGHT_MODEL (default: gpt-5-mini)
  - OPENAI_ULTRA_LIGHT_MODEL (default: gpt-5-nano)

### Netlify Functions
- `.netlify/functions/*` includes orchestrators, enrichment, progress, and proxies
- Start orchestration via `/.netlify/functions/orchestrator-start`
- Check progress via `/.netlify/functions/check-progress`
- Browser data proxy: `/.netlify/functions/user-data-proxy`

### Database & RLS (Supabase)
- Use `fix_rls_policies.sql` for dev-friendly policies and indexes
- The DB auto-generates UUIDs for primary keys
- `api_usage_logs.user_id` can be null in dev; logging retries with null on FK errors

### Progressive UX
- Personas load first; “Live results are loading…” appears
- Businesses and DMs stream in; subtle toasts on insert
- DM profiles show “Enriching…” until email/phone are found
- Loading overlay bars map to phases: starting → personas → businesses → DMs → market_research → completed

### Troubleshooting
- If UI appears idle, polling fallback in `useRealTimeSearch` refreshes every 5s
- CORS/auth hiccups: data proxy is auto-used as fallback
- Serper quota/auth: Google CSE fallback kicks in when configured
- Country code mapping: “SA” is reserved for Saudi Arabia (sa). Use “ZA” or “South Africa” explicitly for South Africa.

### Scripts
- `npm run dev` – Vite dev server
- `npm run build` – Production build
- `npm run lint` – ESLint (use `--fix` to auto-fix)

### Security
- Contact enrichment (emails/phones) runs only server-side via `/.netlify/functions/enrich-decision-makers`
- No secrets in client bundles

### Notes
- Keep only canonical SQL: `fix_rls_policies.sql`, `fix_authentication_and_database.sql`, `fix_proxy_authentication.sql`, `complete_database_setup_fixed.sql`
- Remove ad‑hoc logs and legacy SQLs from repo (already cleaned)
