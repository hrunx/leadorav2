import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import logger from '../../src/lib/logger';

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  logger.info('🔧 Debug Database Insertion');

  const userId = '0f63cc8c-03b0-4d4c-bddf-0c7ccecc7edb';
  const results = {
    environment_check: null as any,
    direct_database_test: null as any,
    insertBusinesses_test: null as any,
    agent_tool_test: null as any,
    rls_policy_test: null as any
  };

  try {
    // Step 1: Environment Check
    logger.info('🔍 Step 1: Environment check...');
    results.environment_check = {
      SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      supabase_url: process.env.VITE_SUPABASE_URL,
      key_length: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0
    };

    // Step 2: Direct Database Test
    logger.info('🔍 Step 2: Direct database insertion test...');
    try {
      // Create test search first
      const { data: testSearch, error: searchError } = await supa
        .from('user_searches')
        .insert({
          user_id: userId,
          search_type: 'customer',
          product_service: 'Debug Test Product',
          industries: ['Technology'],
          countries: ['United States'],
          status: 'in_progress'
        })
        .select()
        .single();

      if (searchError) throw searchError;

      // Test direct business insertion
      const testBusiness = {
        search_id: testSearch.id,
        user_id: userId,
        name: 'Debug Test Company',
        industry: 'Technology',
        country: 'United States',
        city: 'San Francisco',
        size: 'Medium',
        revenue: '$10M-50M',
        description: 'Test company for debugging database insertion',
        match_score: 85,
        persona_type: 'customer',
        relevant_departments: ['Engineering'],
        key_products: ['Debug Test Product'],
        recent_activity: []
      };

      const { data: insertedBusiness, error: businessError } = await supa
        .from('businesses')
        .insert(testBusiness)
        .select()
        .single();

      if (businessError) throw businessError;

      results.direct_database_test = {
        success: true,
        search_id: testSearch.id,
        business_id: insertedBusiness.id,
        business_name: insertedBusiness.name
      };

      // Clean up
      await supa.from('businesses').delete().eq('id', insertedBusiness.id);
      await supa.from('user_searches').delete().eq('id', testSearch.id);

    } catch (error: any) {
      results.direct_database_test = {
        success: false,
        error: error.message,
        error_details: error
      };
    }

    // Step 3: Test insertBusinesses function
    logger.info('🔍 Step 3: Testing insertBusinesses function...');
    try {
      const { insertBusinesses } = await import('../../src/tools/db.write');

      // Create test search
      const { data: testSearch2, error: searchError2 } = await supa
        .from('user_searches')
        .insert({
          user_id: userId,
          search_type: 'customer',
          product_service: 'Function Test Product',
          industries: ['Technology'],
          countries: ['United States'],
          status: 'in_progress'
        })
        .select()
        .single();

      if (searchError2) throw searchError2;

      const testBusinessRows = [{
        search_id: testSearch2.id,
        user_id: userId,
        name: 'Function Test Company',
        industry: 'Technology',
        country: 'United States',
        city: 'San Francisco',
        size: 'Medium',
        revenue: '$10M-50M',
        description: 'Test company for function testing',
        match_score: 90,
        persona_type: 'customer',
        relevant_departments: ['Engineering'],
        key_products: ['Function Test Product'],
        recent_activity: []
      }];

      const insertedBusinesses = await insertBusinesses(testBusinessRows);

      results.insertBusinesses_test = {
        success: true,
        search_id: testSearch2.id,
        businesses_inserted: insertedBusinesses.length,
        sample_business: insertedBusinesses[0] ? {
          id: insertedBusinesses[0].id,
          name: insertedBusinesses[0].name
        } : null
      };

      // Clean up
      if (insertedBusinesses.length > 0) {
        await supa.from('businesses').delete().eq('search_id', testSearch2.id);
      }
      await supa.from('user_searches').delete().eq('id', testSearch2.id);

    } catch (error: any) {
      results.insertBusinesses_test = {
        success: false,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5)
      };
    }

    // Step 4: Test Business Discovery Agent Tool
    logger.info('🔍 Step 4: Testing business discovery agent tool logic...');
    try {
      const { buildBusinessData } = await import('../../src/tools/util');

      // Create test search
      const { data: testSearch3, error: searchError3 } = await supa
        .from('user_searches')
        .insert({
          user_id: userId,
          search_type: 'customer',
          product_service: 'Agent Test Product',
          industries: ['Technology'],
          countries: ['United States'],
          status: 'in_progress'
        })
        .select()
        .single();

      if (searchError3) throw searchError3;

      // Test buildBusinessData function
      const businessData = buildBusinessData({
        search_id: testSearch3.id,
        user_id: userId,
        persona_id: null,
        name: 'Agent Test Company',
        industry: 'Technology',
        country: 'United States',
        address: '123 Test St, San Francisco, CA',
        city: 'San Francisco',
        phone: '555-0123',
        website: 'https://test.com',
        rating: 4.5,
        size: 'Medium',
        revenue: '$10M-50M',
        description: 'Test company for agent testing',
        match_score: 95,
        persona_type: 'customer',
        relevant_departments: ['Engineering'],
        key_products: ['Agent Test Product'],
        recent_activity: []
      });

      // Test insertion via agent logic
      const { insertBusinesses: insertBusinessesFunc } = await import('../../src/tools/db.write');
      const insertedViaAgent = await insertBusinessesFunc([businessData as any]);

      results.agent_tool_test = {
        success: true,
        search_id: testSearch3.id,
        business_data_built: !!businessData,
        businesses_inserted: insertedViaAgent.length,
        sample_business: insertedViaAgent[0] ? {
          id: insertedViaAgent[0].id,
          name: insertedViaAgent[0].name,
          match_score: insertedViaAgent[0].match_score
        } : null
      };

      // Clean up
      if (insertedViaAgent.length > 0) {
        await supa.from('businesses').delete().eq('search_id', testSearch3.id);
      }
      await supa.from('user_searches').delete().eq('id', testSearch3.id);

    } catch (error: any) {
      results.agent_tool_test = {
        success: false,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5)
      };
    }

    // Step 5: RLS Policy Test
    logger.info('🔍 Step 5: Testing RLS policies...');
    try {
      // Test with anon key to see if RLS is blocking
      const anonSupa = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.VITE_SUPABASE_ANON_KEY!
      );

      const { error: rlsError } = await anonSupa
        .from('businesses')
        .select('id')
        .limit(1);

      results.rls_policy_test = {
        anon_key_available: !!process.env.VITE_SUPABASE_ANON_KEY,
        anon_can_read: !rlsError,
        rls_error: rlsError?.message || null,
        service_role_permissions: 'assumed_full_access'
      };

    } catch (error: any) {
      results.rls_policy_test = {
        success: false,
        error: error.message
      };
    }

    // Analysis
    const analysis = {
      database_connection: results.direct_database_test?.success || false,
      insert_function_working: results.insertBusinesses_test?.success || false,
      agent_logic_working: results.agent_tool_test?.success || false,
      environment_configured: results.environment_check?.SUPABASE_URL && results.environment_check?.SUPABASE_SERVICE_ROLE_KEY,
      critical_issues: [
        ...((!results.direct_database_test?.success) ? ['Direct database insertion failing'] : []),
        ...((!results.insertBusinesses_test?.success) ? ['insertBusinesses function failing'] : []),
        ...((!results.agent_tool_test?.success) ? ['Agent tool logic failing'] : []),
        ...((!results.environment_check?.SUPABASE_URL) ? ['Missing SUPABASE_URL'] : []),
        ...((!results.environment_check?.SUPABASE_SERVICE_ROLE_KEY) ? ['Missing SERVICE_ROLE_KEY'] : [])
      ]
    };

    logger.info('🎯 Database Insertion Debug Complete', {
      database_working: analysis.database_connection,
      function_working: analysis.insert_function_working,
      agent_working: analysis.agent_logic_working,
      issues: analysis.critical_issues.length
    });

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ...results,
        analysis,
        recommendations: [
          ...(analysis.critical_issues.length === 0 ? ['All database operations working - issue may be in agent execution flow'] : []),
          ...analysis.critical_issues.map(issue => `Fix: ${issue}`),
          ...((!analysis.database_connection) ? ['Check Supabase connection and credentials'] : []),
          ...((!analysis.insert_function_working) ? ['Debug insertBusinesses function implementation'] : [])
        ]
      }, null, 2)
    };

  } catch (error: any) {
    logger.error('❌ Database Insertion Debug failed', { error: error.message });
    
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        partial_results: results
      })
    };
  }
};
