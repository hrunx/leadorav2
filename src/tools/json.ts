export function extractJson(text: string): unknown | null {
  if (!text) return null;

  const jsonFence = '```json';
  const fence = '```';
  let start = text.indexOf(jsonFence);
  if (start !== -1) {
    start += jsonFence.length;
  } else {
    start = text.indexOf(fence);
    if (start !== -1) {
      start += fence.length;
    }
  }

  let jsonString = text;
  if (start !== -1) {
    const end = text.indexOf(fence, start);
    jsonString = end !== -1 ? text.slice(start, end) : text.slice(start);
  }

  try {
    return JSON.parse(jsonString.trim());
  } catch {
    return null;
  }
}
