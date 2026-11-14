import { loops, type GraphGoblinClient, type LoopDefinitionBody } from '@graphgoblin/api-client';
import { UlidSchema } from '@graphgoblin/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard } from './results.js';

// The gateway owns validation and returns its detailed field issues after checking credentials.
const definition = z
  .record(z.string(), z.unknown())
  .describe('The complete GraphGoblin loop definition, including schemaVersion, nodes and edges.');
const loopId = UlidSchema.describe(
  'The exact loop id returned by list_loops or create_loop_draft.',
);
const draftToken = z
  .string()
  .regex(/^[0-9a-f]{16}$/)
  .describe(
    'The draftToken returned by get_loop_draft or the prior save. Use the token of the base you edited.',
  );
const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, openWorldHint: false };

export function registerDraftTools(server: McpServer, client: GraphGoblinClient): void {
  server.registerTool(
    'create_loop_draft',
    {
      title: 'Create loop draft',
      description:
        'Create a new loop with a draft. Returns its id and validation issues. The draft stays unpublished.',
      inputSchema: { definition },
      annotations: { ...write, destructiveHint: false, idempotentHint: false },
    },
    ({ definition }) => guard(() => loops.create(client, definition as LoopDefinitionBody)),
  );
  server.registerTool(
    'get_loop_draft',
    {
      title: 'Read loop draft',
      description:
        'Read the draft or published base, if any, and its draftToken for optimistic draft saves.',
      inputSchema: { loopId },
      annotations: read,
    },
    ({ loopId }) => guard(() => loops.get(client, loopId)),
  );
  server.registerTool(
    'validate_loop_definition',
    {
      title: 'Validate loop definition',
      description:
        'Check a proposed definition for an existing loop without saving. Returns issues and publishable.',
      inputSchema: { loopId, definition },
      annotations: read,
    },
    ({ loopId, definition }) =>
      guard(() => loops.validate(client, loopId, definition as LoopDefinitionBody)),
  );
  server.registerTool(
    'save_loop_draft',
    {
      title: 'Save loop draft',
      description:
        'Save the definition with the supplied draftToken. DRAFT_CONFLICT means the base has changed. Read the latest copy and reconcile the changes before saving again.',
      inputSchema: { loopId, definition, draftToken },
      annotations: { ...write, destructiveHint: true },
    },
    ({ loopId, definition, draftToken }) =>
      guard(() =>
        loops.saveDraft(client, loopId, definition as LoopDefinitionBody, { ifMatch: draftToken }),
      ),
  );
}
