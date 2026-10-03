import type { ContextThread, Invocation } from '@graphgoblin/contracts';

export interface InitialThreadInput {
  runId: string;
  loopId: string;
  versionId: string;
  parentRunId?: string;
  invocation: Invocation;
  /** Optional seed, used by subloops to hand a mapped thread to the child. */
  seed?: Pick<Partial<ContextThread>, 'messages' | 'vars' | 'artifacts' | 'outputs' | 'lastOutput'>;
}

export function createInitialThread(input: InitialThreadInput): ContextThread {
  return {
    schemaVersion: 1,
    run: {
      id: input.runId,
      loopId: input.loopId,
      versionId: input.versionId,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      iteration: 1,
    },
    invocation: input.invocation,
    messages: input.seed?.messages ?? [],
    vars: input.seed?.vars ?? {},
    artifacts: input.seed?.artifacts ?? [],
    outputs: input.seed?.outputs ?? {},
    ...(input.seed?.lastOutput ? { lastOutput: input.seed.lastOutput } : {}),
    counters: {
      nodeVisits: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    },
  };
}
