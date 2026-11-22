/**
 * Rewrite advertised MCP tool input schemas so strict clients (notably Gemini function declarations)
 * will accept them. Runtime Zod validation is unchanged: this only affects tools/list.
 *
 * Strips or rewrites: $schema, additionalProperties, format, default, exclusiveMinimum/Maximum,
 * integer→number, const, $ref (inlined), empty properties, and number|null anyOf unions.
 */
const DROP = new Set(["$schema", "additionalProperties", "default", "format", "const"]);

function resolveRef(root: any, ref: string): any {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let cur = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = cur?.[key];
  }
  return cur;
}

function walk(node: any, root: any): any {
  if (Array.isArray(node)) return node.map((n) => walk(n, root));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const resolved = resolveRef(root, node.$ref);
    if (resolved && typeof resolved === "object") {
      const { $ref: _r, ...rest } = node;
      return walk({ ...resolved, ...rest }, root);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k) || k === "exclusiveMinimum" || k === "exclusiveMaximum" || k === "$ref") continue;
    if (k === "type" && v === "integer") { out.type = "number"; continue; }
    out[k] = walk(v, root);
  }
  if (typeof node.exclusiveMinimum === "number" && out.minimum === undefined) out.minimum = node.exclusiveMinimum;
  if (typeof node.exclusiveMaximum === "number" && out.maximum === undefined) out.maximum = node.exclusiveMaximum;
  if (Array.isArray(out.anyOf)) {
    const variants = out.anyOf as any[];
    const nonNull = variants.filter((s) => s && s.type !== "null");
    if (nonNull.length === 1 && variants.some((s) => s && s.type === "null")) {
      const { anyOf: _a, ...rest } = out;
      Object.assign(rest, nonNull[0]);
      return rest;
    }
  }
  if (out.properties && typeof out.properties === "object" && !Array.isArray(out.properties) && Object.keys(out.properties as object).length === 0) {
    delete out.properties;
  }
  return out;
}

export function sanitizeMcpJsonSchema(schema: unknown): Record<string, unknown> {
  const root = schema && typeof schema === "object" ? JSON.parse(JSON.stringify(schema)) : { type: "object" };
  const cleaned = walk(root, root);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) return { type: "object" };
  if (!cleaned.type) cleaned.type = "object";
  return cleaned as Record<string, unknown>;
}

/** Keywords Gemini (and similar function-declaration clients) have been seen to reject. */
export const GEMINI_SCHEMA_FORBIDDEN = /\$schema|additionalProperties|"format"|exclusiveMinimum|exclusiveMaximum|"const"|\$ref|"type"\s*:\s*"integer"/;

/** After tools are registered, wrap tools/list so advertised schemas are Gemini-safe. Zod validation is untouched. */
export function advertiseCompatibleToolSchemas(server: { server: { _requestHandlers?: Map<string, Function> } }) {
  const handlers = (server.server as any)._requestHandlers as Map<string, Function> | undefined;
  const prev = handlers?.get("tools/list");
  if (!prev || !handlers) return;
  handlers.set("tools/list", async (request: unknown, extra: unknown) => {
    const result = await prev(request, extra);
    if (result?.tools) {
      for (const t of result.tools) t.inputSchema = sanitizeMcpJsonSchema(t.inputSchema);
    }
    return result;
  });
}
