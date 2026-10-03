import { GraphGoblinApiError } from '@graphgoblin/api-client';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** A failure raised by the MCP layer itself, reported like an API problem with a stable code. */
export class McpToolError extends Error {
  override readonly name = 'McpToolError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A successful tool result: pretty JSON text for the model plus the same value as structured content. */
export function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { structuredContent: value as Record<string, unknown> }
      : {}),
  };
}

/**
 * Describe a failure for the agent. API problem details keep their stable `code` at the front of
 * the message so the agent (and the skills) can branch on it, for example `RUN_NOT_FOUND`.
 */
export function describeError(error: unknown): string {
  if (error instanceof GraphGoblinApiError) {
    const head = `${error.code} (HTTP ${error.status})`;
    const detail = error.detail ? `: ${error.detail}` : '';
    const issues =
      error.errors === undefined ? '' : `\nerrors: ${JSON.stringify(error.errors, null, 2)}`;
    return `GraphGoblin API error ${head}${detail}${issues}`;
  }
  if (error instanceof McpToolError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `INTERNAL_ERROR: ${error.message}`;
  return `INTERNAL_ERROR: ${String(error)}`;
}

/** An MCP tool error result (`isError: true`) for any thrown value. */
export function toolError(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: describeError(error) }] };
}

/** Run a tool body and turn its value or failure into a tool result. */
export async function guard(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    return toolError(error);
  }
}
