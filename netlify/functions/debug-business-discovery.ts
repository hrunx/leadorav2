import type { Handler } from '@netlify/functions';
import { serperPlaces } from '../../src/tools/serper';
import { countryToGL } from '../../src/tools/util';

export const handler: Handler = async (event) => {
  try {
    const { product_service = "CRM software", industry = "Technology", country = "United States" } = JSON.parse(event.body || '{}');
    
    console.log(`Testing business discovery with: ${product_service} in ${industry} industry in ${country}`);
    
    // Test 1: Country mapping
    const gl = countryToGL(country);
    console.log(`Country "${country}" mapped to GL code: "${gl}"`);
    
    // Test 2: Query construction 
    const intent = 'need'; // customer search
    const q = `${product_service} ${intent} ${industry} ${country}`;
    console.log(`Constructed query: "${q}"`);
    
    // Test 3: Serper Places call
    console.log('Calling Serper Places...');
    const places = await serperPlaces(q, gl, 5);
    console.log(`Found ${places.length} places`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        test_params: { product_service, industry, country },
        gl_mapping: gl,
        query: q,
        places_found: places.length,
        places: places,
        serper_key_present: !!process.env.SERPER_KEY
      })
    };
    
  } catch (error: any) {
    console.error('Debug business discovery error:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        serper_key_present: !!process.env.SERPER_KEY
      })
    };
  }
};