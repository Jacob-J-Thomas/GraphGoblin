import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';
import { layerConfig, serverSwitches } from './isolation.js';

/** The slice of the SDK's `Thread` the harness uses. Tests substitute a fixture replayer. */
export interface CodexThreadLike {
  runStreamed(
    input: string,
    options?: TurnOptions,
  ): Promise<{ events: AsyncIterable<ThreadEvent | { type: string }> }>;
}

/** The slice of the SDK's `Codex` client the harness uses. */
export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
}

export type CodexClientFactory = (options: CodexOptions) => CodexClientLike;

/** The names of the MCP servers the CLI would start for a turn in this working directory. */
export type ServerLister = (
  workingDirectory: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<string[]>;

/**
 * The SDK client for real turns (ADR-0063). Before each turn it lists the machine's MCP servers
 * and starts the CLI with each one switched off, ahead of the defaults and node overrides in
 * `options.config`. Constructing it, or a thread, spawns nothing; a turn's start follows the
 * listing.
 */
export function isolatedClient(options: CodexOptions, list: ServerLister): CodexClientLike {
  const thread = (
    threadOptions: ThreadOptions | undefined,
    open: (client: Codex) => CodexThreadLike,
  ): CodexThreadLike => ({
    async runStreamed(input, turnOptions) {
      const signal = turnOptions?.signal;
      const servers = await list(threadOptions?.workingDirectory, signal);
      signal?.throwIfAborted();
      const config = layerConfig(serverSwitches(servers), options.config ?? {});
      return open(new Codex({ ...options, config })).runStreamed(input, turnOptions);
    },
  });
  return {
    startThread: (threadOptions) => thread(threadOptions, (c) => c.startThread(threadOptions)),
    resumeThread: (id, threadOptions) =>
      thread(threadOptions, (c) => c.resumeThread(id, threadOptions)),
  };
}
