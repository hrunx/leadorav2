/**
 * Get the correct base URL for Netlify functions
 * In development: use localhost:8888 (where Netlify dev runs)
 * In production: use the current origin
 */
export function getNetlifyFunctionsBaseUrl(): string {
  // If we're in a browser environment
  if (typeof window !== 'undefined') {
    // In development mode, Netlify functions run on port 8888
    if (import.meta.env.MODE === 'development') {
      return 'http://localhost:8888';
    }
    // In production, use the current origin
    return window.location.origin;
  }
  
  // Server-side (should not happen for this function, but just in case)
  return process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
}

/**
 * Build a complete URL for a Netlify function
 */
export function buildNetlifyFunctionUrl(functionName: string, params?: Record<string, string>): string {
  const base = getNetlifyFunctionsBaseUrl();
  const url = new URL(`/.netlify/functions/${functionName}`, base);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  
  return url.toString();
}

/**
 * Build a simple proxy URL for user-data-proxy function
 */
export function buildProxyUrl(table: string, params: Record<string, string>): string {
  return buildNetlifyFunctionUrl('user-data-proxy', { table, ...params });
}
