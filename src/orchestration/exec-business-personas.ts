import { runBusinessPersonas } from '../agents/business-persona.agent';
import { loadSearch } from '../tools/db.read';

export async function execBusinessPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // Use robust path with Gemini-first, strict validation, placeholder fallback
  return await runBusinessPersonas({
    id: search.id,
    user_id: search.user_id,
    product_service: search.product_service,
    industries: search.industries,
    countries: search.countries,
    search_type: search.search_type,
  });
}