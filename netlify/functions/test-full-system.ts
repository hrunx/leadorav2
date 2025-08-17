import type { Handler } from '@netlify/functions';

export const handler: Handler = async () => {
  // Minimal health payload so jq can parse JSON
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, name: 'test-full-system', env: 'local' })
  };
};


