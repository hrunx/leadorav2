# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Leadora is a production-grade, serverless multi-agent system for B2B lead generation powered by GPT-5. The system orchestrates parallel AI agents to discover business personas, map decision makers, discover businesses, and generate market insights.

### Core Architecture

**Frontend Stack:**
- Vite + React 18 + TypeScript
- Tailwind CSS for styling
- React Router for navigation

**Backend Stack:**
- Netlify Functions (serverless TypeScript)
- Supabase (PostgreSQL + Realtime)
- Multi-model AI agents (GPT-5 primary, Gemini 2.0, DeepSeek)

**Key External APIs:**
- Serper API (Google Places/Search) with Google CSE fallback
- OpenAI GPT models for agents
- Contact enrichment services

## Common Commands

### Development
```bash
# Install dependencies
npm ci

# Start dev server with Netlify functions
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Code Quality
```bash
# Lint code (with auto-fix)
npm run lint -- --fix

# Type checking
npm run typecheck

# Run tests
npm run test
```

### Debugging and Testing
```bash
# Test individual agents
curl -X POST http://localhost:9999/.netlify/functions/test-individual-agents

# Test full system end-to-end
curl -X POST http://localhost:9999/.netlify/functions/test-full-system \
  -H "Content-Type: application/json" \
  -d '{"search_id": "test-id", "user_id": "test-user"}'

# Check orchestration progress
curl -X POST http://localhost:9999/.netlify/functions/check-progress \
  -H "Content-Type: application/json" \
  -d '{"search_id": "your-search-id"}'

# Debug business discovery
curl -X POST http://localhost:9999/.netlify/functions/debug-business-discovery \
  -H "Content-Type: application/json" \
  -d '{"search_id": "your-search-id", "insert": true}'

# Enrich decision maker contacts
curl -X POST http://localhost:9999/.netlify/functions/enrich-decision-makers \
  -H "Content-Type: application/json" \
  -d '{"search_id": "your-search-id"}'
```

## Architecture Deep Dive

### Multi-Agent Orchestration

The core orchestration happens in `src/orchestration/orchestrate.ts`, which runs 4 parallel agents:

1. **Business Personas Agent** (`business-persona.agent.ts`) - Creates 3 business personas using GPT-4o-mini → Gemini 2.0 Flash → DeepSeek fallback chain
2. **Decision Maker Personas Agent** (`dm-persona.agent.ts`) - Creates 3 decision maker personas using same GPT-4o-mini → Gemini → DeepSeek fallback
3. **Business Discovery Agent** (`business-discovery.agent.ts`) - Discovers businesses via Serper API with batched processing and instant DM discovery
4. **Market Research Agent** (`market-research.agent.ts` / `market-research-advanced.agent.ts`) - Generates TAM/SAM/SOM analysis
5. **Enrichment Agent** (`enrich-decision-makers.ts`) - Enriches decision makers with real contact information (emails, phone, LinkedIn) using Hunter.io + Serper search

### Key Design Patterns

**Zero-Console Policy**: The entire application uses a centralized logger (`src/lib/logger.ts`) that eliminates console output in production and provides PII redaction.

**Graceful Degradation**: 
- Serper API → Google CSE fallback when quotas exceeded
- DB and in-memory caching for API responses
- Conservative batching (3 businesses/500ms) to avoid rate limits

**Real-time Updates**: Uses Supabase Realtime + Server-Sent Events for live progress updates to the UI.

**Strict Typing**: All agents use Zod schemas for validation, with TypeScript interfaces defined in `src/lib/supabase.ts`.

### Database Schema

Key Supabase tables:
- `user_searches` - Search configurations and status
- `business_personas` / `dm_personas` - Generated personas 
- `businesses` / `decision_makers` - Discovered entities
- `market_insights` - Research results with structured data
- Row Level Security (RLS) enforced on all tables

### Netlify Functions Structure

**Orchestration Flow:**
1. `orchestrator-start.ts` - Accepts search requests, triggers background processing
2. `orchestrator-run-background.ts` - Runs the main orchestration logic
3. `check-progress.ts` - Reports real-time progress to UI

**Data Access:**
- `user-data-proxy.ts` - RLS-aware data access for frontend
- `enrich-decision-makers.ts` - Server-side contact enrichment

### Model Configuration

The system uses a **cost-effective, fast model hierarchy**:
- **Primary Model**: GPT-4o-mini (default) - Fast and cost-effective for persona generation
- **Fallback 1**: Gemini 2.0 Flash Experimental - Google's latest model
- **Fallback 2**: DeepSeek - Open source alternative

Model routing is configured in `src/agents/clients.ts`:
- `resolveModel('primary')` → GPT-4o-mini
- `resolveModel('light')` → GPT-4o-mini  
- `resolveModel('ultraLight')` → GPT-4o-mini

### Environment Variables

Critical variables for development:
- `VITE_SUPABASE_URL` / `SUPABASE_URL` - Database connection
- `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` - Client auth key  
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side database access
- `SERPER_KEY` - Business discovery API
- `OPENAI_API_KEY` - AI model access
- `OPENAI_PRIMARY_MODEL` - Override default model (default: "gpt-4o-mini")
- `GEMINI_API_KEY` - Google Gemini API key (for fallback)
- `DEEPSEEK_API_KEY` - DeepSeek API key (for fallback)
- `HUNTER_API_KEY` - Hunter.io for email enrichment (optional)

## Development Guidelines

### Agent Development

When creating new agents:
- Follow the pattern in `src/agents/` - each agent exports a `run*` function
- Use the centralized logger, never `console.log`
- Implement proper error handling with graceful fallbacks
- Use Zod schemas for input/output validation
- Leverage the persona mapper (`src/tools/persona-mapper.ts`) for entity matching

### Database Operations

- Read operations: Use `src/tools/db.read.ts` utilities
- Write operations: Use `src/tools/db.write.ts` utilities  
- Always handle RLS policies - use service role key in functions, anon key in browser
- Cache expensive queries using `src/tools/query-cache.ts`

### Testing Approach

The project includes comprehensive test functions:
- Individual agent testing via dedicated endpoints
- Full system integration tests
- Debug utilities for troubleshooting orchestration issues

### Cursor Rules Integration

The project follows specific patterns defined in `.cursor/rules/leadorav2.mdc`:
- Structured error handling with `{ success: boolean }` patterns
- Proper TypeScript typing for all API responses
- SSE (Server-Sent Events) for real-time updates
- Country code mapping and internationalization considerations

### Performance Considerations

**API Rate Limiting:**
- Business discovery limited to 6 businesses/second
- OpenAI calls have configurable concurrency (`OPENAI_MAX_CONCURRENT`)
- Minimum delays between API calls (`OPENAI_MIN_DELAY_MS`)

**Caching Strategy:**
- In-memory cache for repeated API calls
- Database-backed cache for expensive operations
- Fallback mechanisms when primary APIs fail

## Deployment

The application deploys to Netlify with:
- Node.js 20 runtime
- esbuild bundling for functions
- All dependencies bundled (no externalization)
- Environment variables configured in Netlify dashboard

Database setup requires running the SQL files in order:
1. `complete_database_setup_fixed.sql`
2. `fix_authentication_and_database.sql` 
3. `fix_proxy_authentication.sql`
4. `fix_rls_policies.sql`
