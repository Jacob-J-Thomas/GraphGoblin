import { runs, type GraphGoblinClient } from '@graphgoblin/api-client';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/** Upper bound on events returned by the events resource; read_run_events pages beyond it. */
export const MAX_RESOURCE_EVENTS = 10_000;
const PAGE = 1000;
const RECENT_RUNS = 20;

function json(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) },
    ],
  };
}

function idOf(variables: Record<string, string | string[]>): string {
  return decodeURIComponent(String(variables['id']));
}

/** Read the whole event log (up to {@link MAX_RESOURCE_EVENTS}) by paging `GET /runs/{id}/events`. */
export async function readAllEvents(
  client: GraphGoblinClient,
  runId: string,
  pageSize = PAGE,
  max = MAX_RESOURCE_EVENTS,
) {
  const items = [];
  let after = 0;
  for (;;) {
    const page = await runs.events(client, runId, { after, limit: pageSize });
    items.push(...page.items);
    if (page.items.length < pageSize || items.length >= max) {
      return { runId, items, truncated: page.items.length === pageSize, nextAfter: page.nextAfter };
    }
    after = page.nextAfter;
  }
}

/** `graphgoblin://runs/{id}/events` and `graphgoblin://runs/{id}/thread`, listing the recent runs. */
export function registerResources(server: McpServer, client: GraphGoblinClient): void {
  const recent = (suffix: 'events' | 'thread', label: string) => async () => ({
    resources: (await runs.list(client, { limit: RECENT_RUNS })).map((run) => ({
      uri: `graphgoblin://runs/${run.id}/${suffix}`,
      name: `${label} of run ${run.id} (${run.status})`,
      mimeType: 'application/json',
    })),
  });

  server.registerResource(
    'run-events',
    new ResourceTemplate('graphgoblin://runs/{id}/events', { list: recent('events', 'Events') }),
    {
      title: 'Run event log',
      description:
        'The persisted event log of a run as JSON, in sequence order (up to 10,000 events; page further with read_run_events).',
      mimeType: 'application/json',
    },
    async (uri, variables) => json(uri, await readAllEvents(client, idOf(variables))),
  );

  server.registerResource(
    'run-thread',
    new ResourceTemplate('graphgoblin://runs/{id}/thread', { list: recent('thread', 'Thread') }),
    {
      title: 'Run context thread',
      description:
        'The current context thread of a run as JSON: messages, vars, artifacts, outputs.',
      mimeType: 'application/json',
    },
    async (uri, variables) => json(uri, await runs.thread(client, idOf(variables))),
  );
}
