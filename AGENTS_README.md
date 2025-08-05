# Leadora Multi-Agent System

## Environment Variables Required

Add these to your `.env` file:

```bash
# Existing Supabase Config (already present)
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# New Agent System Variables
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DEEPSEEK_API_KEY=your_deepseek_api_key  
SERPER_KEY=your_serper_api_key
GEMINI_API_KEY=your_gemini_api_key
```

## Agent System Architecture

### 5 Independent Agents:
1. **BusinessPersonaAgent** → Generates 5 business personas
2. **BusinessDiscoveryAgent** → Finds businesses via Serper Places API
3. **DMPersonaAgent** → Generates 5 decision maker personas  
4. **DMDiscoveryAgent** → Finds decision makers via LinkedIn search
5. **MarketResearchAgent** → Creates market insights with Gemini

### Orchestration Flow:
- **Phase A (Parallel)**: BusinessPersonaAgent + DMPersonaAgent
- **Phase B**: BusinessDiscoveryAgent (needs business personas)
- **Phase C**: DMDiscoveryAgent (needs businesses + DM personas)
- **Phase D**: MarketResearchAgent (reads all data)

### API Endpoint:
`POST /netlify/functions/agents-orchestrator`
```json
{ "search_id": "uuid", "user_id": "uuid" }
```

## File Structure Created:

```
src/
├── agents/
│   ├── clients.ts                    # Shared API clients
│   ├── business-persona.agent.ts     # Generate business personas
│   ├── business-discovery.agent.ts   # Find businesses via Serper
│   ├── dm-persona.agent.ts          # Generate DM personas
│   ├── dm-discovery.agent.ts        # Find decision makers
│   └── market-research.agent.ts     # Market analysis with Gemini
├── tools/
│   ├── util.ts                      # Country mapping utilities
│   ├── serper.ts                    # Serper API integration
│   ├── db.read.ts                   # Database read operations
│   └── db.write.ts                  # Database write operations
└── orchestration/
    └── orchestrate.ts               # Fan-out/fan-in coordinator

netlify/functions/
└── agents-orchestrator.ts          # HTTP entry point
```

## Integration with Existing System

The agent system integrates with your existing search flow by replacing the mock data generation in `SearchService`. When a user creates a search, call the orchestrator endpoint to generate real data instead of using the mock functions.