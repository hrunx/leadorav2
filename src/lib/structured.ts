import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function jsonSchemaFromZod(name: string, schema: z.ZodTypeAny) {
  const js = zodToJsonSchema(schema, name);
  // Ensure a proper JSON Schema object is returned
  return js.definitions?.[name] || js;
}

