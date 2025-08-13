
export interface Persona {
  title: string;
  rank: number;
  demographics: { industry: string };
  [key: string]: any;
}

export async function ensureUniqueTitles(
  personas: Persona[],
  search: { id: string },
  existingTitles?: string[],
  refineFn?: (prompt: string) => Promise<string>
): Promise<Persona[]> {
  let existingSet: Set<string>;
  if (Array.isArray(existingTitles)) {
    existingSet = new Set(existingTitles.map(t => String(t).toLowerCase()));
  } else {
    try {
      const { loadBusinessPersonas } = await import('../tools/db.read');
      const existing = await loadBusinessPersonas(search.id);
      existingSet = new Set(existing.map((p: any) => String(p.title).toLowerCase()));
    } catch {
      existingSet = new Set();
    }
  }
  let result = personas;
  const dupWithExisting = result.some(p => existingSet.has((p.title || '').toLowerCase()));
  if (dupWithExisting) {
    const refinePrompt = `Some titles duplicate existing personas (${Array.from(existingSet).join('; ')}). Rewrite ONLY the titles to be unique and descriptive. Return JSON: {"personas": [{"title":"..."}]}`;
    try {
      let executor = refineFn;
      if (!executor) {
        const { resolveModel, callOpenAIChatJSON } = await import('./clients');
        executor = (p: string) =>
          callOpenAIChatJSON({
            model: resolveModel('light'),
            system: 'Return ONLY JSON with updated titles as instructed.',
            user: p,
            temperature: 0.3,
            maxTokens: 200,
            requireJsonObject: true,
            verbosity: 'low'
          });
      }
      const raw = await executor(refinePrompt);
      const obj = JSON.parse(raw || '{}');
      const newTitles = Array.isArray(obj?.personas)
        ? obj.personas.map((x: any) => x?.title).filter(Boolean)
        : [];
      if (newTitles.length === result.length) {
        result = result.map((p, i) => ({ ...p, title: String(newTitles[i]) }));
      }
    } catch {}
  }

  const seen = new Set(existingSet);
  result = result.map(p => {
    let title = p.title;
    let key = title.toLowerCase();
    if (seen.has(key)) {
      title = `${title} - ${p.demographics.industry} ${p.rank}`;
      key = title.toLowerCase();
    }
    while (seen.has(key)) {
      title = `${title}-${p.rank}`;
      key = title.toLowerCase();
    }
    seen.add(key);
    return { ...p, title };
  });

  return result;
}
