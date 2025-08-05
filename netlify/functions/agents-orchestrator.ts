import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { search_id, user_id } = JSON.parse(event.body || "{}");
    
    if (!search_id || !user_id) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'search_id and user_id are required' }) 
      };
    }

    console.log(`Starting orchestration for search ${search_id}, user ${user_id}`);

    // Dynamic imports (ESM-friendly inside a CJS Lambda wrapper)
    const { execBusinessPersonas } = await import('../../src/orchestration/exec-business-personas.js').catch(() => import('../../src/orchestration/exec-business-personas'));
    const { execDMPersonas }       = await import('../../src/orchestration/exec-dm-personas.js').catch(() => import('../../src/orchestration/exec-dm-personas'));
    const { execBusinessDiscovery }= await import('../../src/orchestration/exec-business-discovery.js').catch(() => import('../../src/orchestration/exec-business-discovery'));
    const { execDMDiscovery }      = await import('../../src/orchestration/exec-dm-discovery.js').catch(() => import('../../src/orchestration/exec-dm-discovery'));
    const { execMarketInsights }   = await import('../../src/orchestration/exec-market-insights.js').catch(() => import('../../src/orchestration/exec-market-insights'));

    // Optional: progress helpers (keep these light)
    const { updateSearchProgress, markSearchCompleted } = await import('../../src/tools/db.write.js').catch(() => import('../../src/tools/db.write'));

    await updateSearchProgress?.(search_id, 5, 'starting');

    // Phase A – personas in parallel
    await Promise.all([
      execBusinessPersonas({ search_id, user_id }),
      execDMPersonas({ search_id, user_id }),
    ]);
    await updateSearchProgress?.(search_id, 25, 'personas');

    // Phase B – businesses
    await execBusinessDiscovery({ search_id, user_id });
    await updateSearchProgress?.(search_id, 60, 'businesses');

    // Phase C – decision makers
    await execDMDiscovery({ search_id, user_id });
    await updateSearchProgress?.(search_id, 85, 'decision_makers');

    // Phase D – market insights
    await execMarketInsights({ search_id, user_id });
    await updateSearchProgress?.(search_id, 100, 'completed');
    await markSearchCompleted?.(search_id);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, search_id })
    };
  } catch (err: any) {
    console.error('Agent orchestration failed:', err);
    
    // Update search status to failed
    try {
      const { search_id } = JSON.parse(event.body || '{}');
      if (search_id) {
        const { updateSearchProgress } = await import('../../src/tools/db.write.js').catch(() => import('../../src/tools/db.write'));
        await updateSearchProgress?.(search_id, 0, 'failed');
      }
    } catch (updateError) {
      console.error('Failed to update search status:', updateError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err?.message || 'Unknown error' })
    };
  }
};