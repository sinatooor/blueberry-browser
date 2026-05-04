// Schema-tree inference for captured JSON responses.
//
// We never hand the full response body to the LLM — bodies can be huge and
// contain noise. Instead we walk the parsed value once and produce a compact
// tree describing the *shape* (types + field names) plus one truncated
// example per leaf. The LLM gets enough to write code against the API; the
// user's data stays bounded.

import type { SchemaNode } from "../../common/types";

export type { SchemaNode };

const MAX_STRING_EXAMPLE = 80;
const MAX_DEPTH = 6;
const MAX_FIELDS = 60;

export function inferSchema(value: unknown, depth = MAX_DEPTH): SchemaNode {
  if (depth <= 0) return { type: "unknown" };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      item: value.length > 0 ? inferSchema(value[0], depth - 1) : null,
      observedLength: value.length,
    };
  }
  switch (typeof value) {
    case "string": {
      const s =
        value.length > MAX_STRING_EXAMPLE
          ? value.slice(0, MAX_STRING_EXAMPLE) + "…"
          : value;
      return { type: "string", example: s };
    }
    case "number":
      return { type: "number", example: value };
    case "boolean":
      return { type: "boolean", example: value };
    case "object": {
      const fields: Record<string, SchemaNode> = {};
      const keys = Object.keys(value as object).slice(0, MAX_FIELDS);
      for (const k of keys) {
        fields[k] = inferSchema(
          (value as Record<string, unknown>)[k],
          depth - 1,
        );
      }
      return { type: "object", fields };
    }
    default:
      return { type: "unknown" };
  }
}

// Renders the tree as compact indented text. This is the format the LLM sees;
// keep it terse and unambiguous.
//
//   object
//     id: number (e.g. 42)
//     items: array[3] of
//       object
//         name: string (e.g. "widget")
export function renderSchema(node: SchemaNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  switch (node.type) {
    case "string":
      return `string${
        node.example !== undefined ? ` (e.g. ${JSON.stringify(node.example)})` : ""
      }`;
    case "number":
      return `number${node.example !== undefined ? ` (e.g. ${node.example})` : ""}`;
    case "boolean":
      return `boolean${
        node.example !== undefined ? ` (e.g. ${node.example})` : ""
      }`;
    case "null":
      return "null";
    case "unknown":
      return "unknown";
    case "array":
      if (!node.item) return `array[0]`;
      return `array[${node.observedLength}] of\n${pad}  ${renderSchema(
        node.item,
        indent + 1,
      )}`;
    case "object": {
      const lines: string[] = ["object"];
      for (const [k, v] of Object.entries(node.fields)) {
        lines.push(`${pad}  ${k}: ${renderSchema(v, indent + 1)}`);
      }
      return lines.join("\n");
    }
  }
}
