/**
 * The MCP tools. Each one is a thin call through `@graphgoblin/api-client`; descriptions are
 * written for the calling agent: when to call it, what to pass, and what to do with the result.
 */
import { GraphGoblinApiError, loops, runs, type GraphGoblinClient } from '@graphgoblin/api-client';
import {
  TERMINAL_RUN_STATUSES,
  UlidSchema,
  type LoopRecord,
  type LoopVersionRecord,
  type RunRecord,
} from '@graphgoblin/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describeLoop, summarizeLoop, summarizeRun } from './describe.js';
import { guard, McpToolError } from './results.js';

export interface ToolOptions {
  /** Delay between `GET /runs/{id}` polls in `wait_for_run`. Default 1000 ms. */
  pollMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export const DEFAULT_WAIT_SECONDS = 60;
export const MAX_WAIT_SECONDS = 600;

const TERMINAL = new Set<string>(TERMINAL_RUN_STATUSES);

const runId = z.string().min(1).describe('The run id (a ULID) returned by start_run or list_runs.');
const loopRef = z
  .string()
  .min(1)
  .describe('The loop id from list_loops, or the exact loop name (case-insensitive).');
const json = z
  .unknown()
  .describe('Any JSON value. Match the inputSchema reported by describe_loop or the waiting spec.');

/** Wait for `ms` or until `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Find a loop by id, or by exact name when no loop has that id. */
export async function resolveLoop(client: GraphGoblinClient, ref: string) {
  // Loop ids are ULIDs (the API rejects anything else with a 400), so other refs are names.
  if (UlidSchema.safeParse(ref).success) {
    try {
      return await loops.get(client, ref);
    } catch (error) {
      if (!(error instanceof GraphGoblinApiError) || error.code !== 'LOOP_NOT_FOUND') throw error;
    }
  }
  const wanted = ref.trim().toLowerCase();
  const matches = (await loops.list(client)).filter((l) => l.name.toLowerCase() === wanted);
  if (matches.length === 0) {
    throw new McpToolError(
      'LOOP_NOT_FOUND',
      `no loop has the id or name "${ref}"; call list_loops to see the available loops`,
    );
  }
  if (matches.length > 1) {
    throw new McpToolError(
      'AMBIGUOUS_LOOP_NAME',
      `${matches.length} loops are named "${ref}" (${matches.map((m) => m.id).join(', ')}); pass the loop id instead`,
    );
  }
  return loops.get(client, (matches[0] as { id: string }).id);
}

type LoopDetail = { loop: LoopRecord; current?: LoopVersionRecord; draft?: LoopVersionRecord };

/** What the agent should do next for a run that has not finished. */
function nextStep(run: RunRecord): string {
  if (run.status === 'waiting' && run.waiting?.kind === 'input') {
    return 'The run is waiting for input. Ask the user if needed, then call provide_input with a value matching waiting.inputSchema, and call wait_for_run again.';
  }
  if (run.status === 'waiting' && run.waiting?.kind === 'signal') {
    return `The run is waiting for the signal "${run.waiting.signalName ?? ''}". Call send_signal if you are the one expected to send it; otherwise call wait_for_run again.`;
  }
  if (run.status === 'paused') return 'The run is paused. Call resume_run to continue it.';
  return 'The run is still in progress. Call wait_for_run again with the same runId; use read_run_events with after=cursor to see what happened so far.';
}

export function registerTools(
  server: McpServer,
  client: GraphGoblinClient,
  options: ToolOptions = {},
): void {
  const pollMs = options.pollMs ?? 1000;
  const now = options.now ?? Date.now;

  server.registerTool(
    'list_loops',
    {
      title: 'List loops',
      description:
        'List the GraphGoblin loops you can run. Call this first when the user names a loop or asks what is available. Returns id, name, description, and whether each loop is published (only published loops can be started without allowDraft). Pass a loop id or exact name to describe_loop before starting it.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Optional case-insensitive substring to filter loop names and descriptions.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query }) =>
      guard(async () => {
        const needle = query?.trim().toLowerCase();
        const items = (await loops.list(client))
          .map((l) => summarizeLoop(l))
          .filter(
            (l) =>
              !needle ||
              l.name.toLowerCase().includes(needle) ||
              (l.description ?? '').toLowerCase().includes(needle),
          );
        return { items };
      }),
  );

  server.registerTool(
    'describe_loop',
    {
      title: 'Describe a loop',
      description:
        'Describe one loop before starting it: its manual triggers with their input JSON schemas, the wait nodes that will ask for input, and each exit node with its return mapping (what the run result will contain). Uses the published version, or the draft when nothing is published. Pass the loop id or exact name. Use the trigger inputSchema to build the input for start_run.',
      inputSchema: { loopId: loopRef },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ loopId }) =>
      guard(async () => describeLoop((await resolveLoop(client, loopId)) as LoopDetail)),
  );

  server.registerTool(
    'start_run',
    {
      title: 'Start a run',
      description:
        'Start a run of a loop from a manual trigger. Returns immediately with the runId; the run executes in the background. Then call wait_for_run with that runId to get the result. Pass input matching the trigger inputSchema from describe_loop. triggerNodeId is only needed when the loop has more than one manual trigger.',
      inputSchema: {
        loopId: loopRef,
        input: json.optional(),
        triggerNodeId: z
          .string()
          .optional()
          .describe('The manual trigger node to start from, when the loop has several.'),
        allowDraft: z
          .boolean()
          .optional()
          .describe('Run the draft version when the loop has no published version. Default false.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ loopId, input, triggerNodeId, allowDraft }) =>
      guard(async () => {
        const detail = await resolveLoop(client, loopId);
        // The engine runs the latest published version unless given a version id, so a draft
        // needs its id passed explicitly.
        const draftId = allowDraft && !detail.current ? detail.draft?.id : undefined;
        const run = await runs.start(client, detail.loop.id, {
          ...(draftId ? { versionId: draftId } : {}),
          ...(input !== undefined ? { input: input as never } : {}),
          ...(triggerNodeId ? { triggerNodeId } : {}),
          ...(allowDraft ? { allowDraft } : {}),
        });
        return {
          runId: run.id,
          loopId: run.loopId,
          versionId: run.versionId,
          status: run.status,
          next: 'Call wait_for_run with this runId to wait for the result.',
        };
      }),
  );

  server.registerTool(
    'wait_for_run',
    {
      title: 'Wait for a run',
      description: `Wait for a run to finish, polling for up to timeoutSeconds (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}). If the run finished (succeeded, failed, cancelled, exhausted) it returns { finished: true, run } with run.result holding the loop's return value and run.failure explaining a failure. Otherwise it returns { finished: false, status, cursor, next }: follow "next". It returns early when the run needs you: waiting for input (call provide_input) or paused (call resume_run). For a long run, keep calling wait_for_run with the same runId. cursor is the last event sequence, usable as "after" in read_run_events.`,
      inputSchema: {
        runId,
        timeoutSeconds: z
          .number()
          .int()
          .min(0)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(`How long to wait. Default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}.`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ runId: id, timeoutSeconds }, extra) =>
      guard(async () => {
        const deadline = now() + (timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
        const progressToken = extra._meta?.progressToken;
        for (let polls = 1; ; polls += 1) {
          const run = await runs.get(client, id);
          if (TERMINAL.has(run.status)) return { finished: true, run };
          const needsCaller =
            run.status === 'paused' || (run.status === 'waiting' && run.waiting?.kind === 'input');
          const remaining = deadline - now();
          if (needsCaller || remaining <= 0) {
            return {
              finished: false,
              status: run.status,
              cursor: run.lastEventSeq,
              ...(run.currentNodeId ? { currentNodeId: run.currentNodeId } : {}),
              ...(run.waiting ? { waiting: run.waiting } : {}),
              next: nextStep(run),
            };
          }
          if (progressToken !== undefined) {
            // Progress notifications let clients that support it extend their request timeout.
            await extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress: polls, message: `run is ${run.status}` },
            });
          }
          await sleep(Math.min(pollMs, remaining), extra.signal);
        }
      }),
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get a run',
      description:
        'Get the current snapshot of a run: status, current node, iteration, what it is waiting for, its result (when succeeded), and its failure (when failed). Call this to check a run without waiting; use wait_for_run to wait.',
      inputSchema: { runId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ runId: id }) => guard(() => runs.get(client, id)),
  );

  server.registerTool(
    'get_run_thread',
    {
      title: 'Get a run thread',
      description:
        "Get a run's context thread: the messages, variables, artifacts, per-node outputs, last output, and usage counters the loop has accumulated. Use it to explain what a run did or to find an intermediate value. It can be large; prefer get_run when you only need the status or result.",
      inputSchema: { runId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ runId: id }) => guard(() => runs.thread(client, id)),
  );

  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description:
        'List runs, newest first, optionally filtered by loop and status. Use it to find a run the user refers to ("the last run of X"). To page, pass nextBefore from the previous page as "before".',
      inputSchema: {
        loopId: z.string().optional().describe('Only runs of this loop id.'),
        status: z
          .array(
            z.enum([
              'queued',
              'running',
              'waiting',
              'paused',
              'succeeded',
              'failed',
              'cancelled',
              'exhausted',
            ]),
          )
          .optional()
          .describe('Only runs in one of these statuses.'),
        parentRunId: z
          .string()
          .optional()
          .describe('Only child runs of this run; pass "none" for top-level runs only.'),
        before: z
          .string()
          .optional()
          .describe('Paging cursor: nextBefore from a previous page (a creation timestamp).'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size. Default 20.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ loopId, status, parentRunId, before, limit }) =>
      guard(async () => {
        const size = limit ?? 20;
        const items = (
          await runs.list(client, {
            ...(loopId ? { loopId } : {}),
            ...(status?.length ? { status: status.join(',') } : {}),
            ...(parentRunId ? { parent: parentRunId } : {}),
            ...(before ? { before } : {}),
            limit: size,
          })
        ).map((r) => summarizeRun(r));
        const last = items.at(-1);
        return { items, ...(items.length === size && last ? { nextBefore: last.createdAt } : {}) };
      }),
  );

  server.registerTool(
    'read_run_events',
    {
      title: 'Read run events',
      description:
        "Read a page of a run's event log in sequence order: node entries and exits, harness items, decisions, waits, and the final run event. Pass after (a sequence number, default 0) and read again with after=nextAfter while hasMore is true. Use it to explain step by step what a run did.",
      inputSchema: {
        runId,
        after: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Return events with a sequence number greater than this. Default 0.'),
        limit: z.number().int().min(1).max(1000).optional().describe('Page size. Default 100.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ runId: id, after, limit }) =>
      guard(async () => {
        const size = limit ?? 100;
        const page = await runs.events(client, id, { after: after ?? 0, limit: size });
        return { ...page, hasMore: page.items.length === size };
      }),
  );

  const control = [
    [
      'cancel_run',
      'Cancel a run',
      'Cancel a run that is queued, running, waiting, or paused. Only do this when the user asks to stop it. Returns the run; the status becomes cancelled once the engine stops it, so call wait_for_run to confirm.',
      runs.cancel,
      true,
    ],
    [
      'pause_run',
      'Pause a run',
      'Pause a run at the next node boundary when the user asks to hold it. It keeps its state; call resume_run to continue it.',
      runs.pause,
      false,
    ],
    [
      'resume_run',
      'Resume a run',
      'Resume a paused run from where it stopped. Then call wait_for_run to follow it to the end.',
      runs.resume,
      false,
    ],
  ] as const;
  for (const [name, title, description, call, destructive] of control) {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { runId },
        annotations: { readOnlyHint: false, destructiveHint: destructive, openWorldHint: false },
      },
      ({ runId: id }) => guard(async () => summarizeRun(await call(client, id))),
    );
  }

  server.registerTool(
    'replay_run',
    {
      title: 'Replay a run from a node',
      description:
        'Debug a run by re-running it from one node: starts a new run (a fork) on the same loop version with the same input, whose context thread is the original run as it was just before that node first started. The original run is not changed. nodeId must be a node the original run reached (see read_run_events for node.started events). Returns the new run; call wait_for_run with its id to follow it.',
      inputSchema: {
        runId,
        nodeId: z
          .string()
          .min(1)
          .describe('The node to start the fork at, for example a nodeId from read_run_events.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ runId: id, nodeId }) =>
      guard(async () => {
        const fork = await runs.replay(client, id, nodeId);
        return {
          ...summarizeRun(fork),
          replayOf: { runId: id, nodeId },
          next: 'Call wait_for_run with this run id to follow the fork.',
        };
      }),
  );

  server.registerTool(
    'provide_input',
    {
      title: 'Provide input to a waiting run',
      description:
        'Answer a run that is waiting for input (wait_for_run or get_run shows status "waiting" with waiting.kind "input"). Pass a value matching waiting.inputSchema; read waiting.prompt to know what is being asked, and ask the user when the answer is theirs to give. Then call wait_for_run again.',
      inputSchema: { runId, input: json },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ runId: id, input }) =>
      guard(async () =>
        summarizeRun(await runs.provideInput(client, id, (input ?? null) as never)),
      ),
  );

  server.registerTool(
    'send_signal',
    {
      title: 'Send a signal to a run',
      description:
        'Deliver a named signal to a run, for wait nodes in signal mode (waiting.kind "signal", waiting.signalName) and heartbeat probes that count signals. Returns woke: true when a waiting node consumed it. Then call wait_for_run to follow the run.',
      inputSchema: {
        runId,
        name: z.string().min(1).describe('The signal name, for example waiting.signalName.'),
        payload: json.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ runId: id, name, payload }) =>
      guard(async () => {
        const result = await runs.signal(client, id, name, payload as never);
        return { woke: result.woke, run: summarizeRun(result.run) };
      }),
  );
}
