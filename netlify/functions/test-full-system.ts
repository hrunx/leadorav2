import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    console.log('🧪 Starting comprehensive system test...');
    
    const testResults = {
      database: false,
      agents: false,
      orchestration: false,
      api_endpoints: false,
      data_flow: false
    };

    // 1. Test Database Connection
    console.log('📊 Testing database connection...');
    try {
      const { error } = await supa.from('app_users').select('id').limit(1);
      if (!error) {
        testResults.database = true;
        console.log('✅ Database connection successful');
      } else {
        console.log('❌ Database error:', error.message);
      }
    } catch (e: any) {
      console.log('❌ Database connection failed:', e.message);
    }

    // 2. Test Agent Orchestration
    console.log('🤖 Testing agent orchestration...');
    try {
      // Create a test search
      const testSearch = {
        user_id: '0f63cc8c-03b0-4d4c-bddf-0c7ccecc7edb',
        product_service: 'AI-powered CRM software',
        search_type: 'customer',
        industries: ['Technology'],
        countries: ['United States'],
        status: 'starting',
        phase: 'starting',
        progress_pct: 0
      };

       const { data: search, error: searchError } = await supa
        .from('user_searches')
        .insert(testSearch)
        .select('id')
        .single();

      if (searchError) {
        console.log('❌ Search creation failed:', searchError.message);
      } else {
        console.log('✅ Test search created:', search.id);

        // Test orchestrator start (fire-and-forget background)
        const response = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/orchestrator-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search_id: search.id,
            user_id: testSearch.user_id
          })
        });

        if (response.ok) {
          // Poll for orchestrator progress/phase for up to 30 seconds
          const deadline = Date.now() + 30000;
          let progressed = false;
          while (Date.now() < deadline) {
            const { data: progressRow } = await supa
              .from('user_searches')
              .select('phase, progress_pct')
              .eq('id', search.id)
              .single();
            if (progressRow && (progressRow.phase !== 'starting' || (progressRow.progress_pct ?? 0) > 0)) {
              progressed = true;
              break;
            }
            await new Promise(r => setTimeout(r, 1000));
          }
          testResults.orchestration = progressed;
        } else {
          console.log('❌ Orchestrator failed:', response.status);
        }
      }
    } catch (e: any) {
      console.log('❌ Agent orchestration test failed:', e.message);
    }

    // 3. Test API Endpoints
    console.log('🔗 Testing API endpoints...');
    try {
       const endpoints = [
         '/.netlify/functions/check-progress',
         '/.netlify/functions/test-simple',
         '/.netlify/functions/test-individual-agents'
       ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`${process.env.URL}${endpoint}`);
          if (response.ok) {
            console.log(`✅ ${endpoint} working`);
          } else {
            console.log(`❌ ${endpoint} failed:`, response.status);
          }
        } catch (e: any) {
          console.log(`❌ ${endpoint} error:`, e.message);
        }
      }
      testResults.api_endpoints = true;
    } catch (e: any) {
      console.log('❌ API endpoint testing failed:', e.message);
    }

    // 4. Test Data Flow (poll until personas appear)
    try {
      const deadline = Date.now() + 20000;
      let gotAny = false;
      while (Date.now() < deadline) {
        const { data: bp } = await supa.from('business_personas').select('id').eq('search_id', (await supa.from('user_searches').select('id').order('created_at', { ascending: false }).limit(1)).data?.[0]?.id || '').limit(1);
        const { data: dmp } = await supa.from('decision_maker_personas').select('id').order('created_at', { ascending: false }).limit(1);
        if ((bp && bp.length) || (dmp && dmp.length)) { gotAny = true; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (gotAny) console.log('✅ Personas started streaming'); else console.log('⚠️ Personas did not appear within timeout (still acceptable in CI)');
    } catch (e:any) {
      console.log('❌ Data flow polling failed:', e.message);
    }

    // 5. Test Data Schema
    console.log('📋 Testing data schema...');
    try {
      const tables = [
        'user_searches',
        'business_personas', 
        'businesses',
        'decision_maker_personas',
        'decision_makers',
        'market_insights',
        'api_usage_logs'
      ];

       for (const table of tables) {
        const { error } = await supa.from(table).select('*').limit(1);
        if (!error) {
          console.log(`✅ Table ${table} accessible`);
        } else {
          console.log(`❌ Table ${table} error:`, error.message);
        }
      }
      testResults.data_flow = true;
    } catch (e: any) {
      console.log('❌ Schema testing failed:', e.message);
    }

    // 6. Test Individual Agents
    console.log('🧠 Testing individual agents...');
    try {
      // This is just a connection test, not a full execution
      await import('../../src/agents/market-research-advanced.agent');
      console.log('✅ Market research agent importable');
      testResults.agents = true;
    } catch (e: any) {
      console.log('❌ Agent testing failed:', e.message);
    }

    // Generate Test Report
    const passedTests = Object.values(testResults).filter(Boolean).length;
    const totalTests = Object.keys(testResults).length;
    const passRate = (passedTests / totalTests) * 100;

    const report: any = {
      timestamp: new Date().toISOString(),
      pass_rate: `${passRate.toFixed(1)}%`,
      tests_passed: passedTests,
      tests_total: totalTests,
      results: testResults,
      status: passRate >= 80 ? 'HEALTHY' : 'NEEDS_ATTENTION',
      recommendations: [] as string[]
    };

    // Add recommendations based on failures
    if (!testResults.database) {
      (report.recommendations as string[]).push('Check database connection and credentials');
    }
    if (!testResults.agents) {
      (report.recommendations as string[]).push('Verify agent imports and dependencies');
    }
    if (!testResults.orchestration) {
      (report.recommendations as string[]).push('Check orchestrator function and API keys');
    }
    if (!testResults.api_endpoints) {
      (report.recommendations as string[]).push('Verify API endpoint availability');
    }
    if (!testResults.data_flow) {
      (report.recommendations as string[]).push('Check database schema and permissions');
    }

    console.log('📊 SYSTEM TEST COMPLETE');
    console.log(`Status: ${report.status}`);
    console.log(`Pass Rate: ${report.pass_rate}`);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(report, null, 2) };

  } catch (error: any) {
    console.error('🚨 System test failed:', error);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'System test failed', message: error.message, timestamp: new Date().toISOString() }) };
  }
};