import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Effort, JsonSchema, Usage } from '@graphgoblin/contracts';
import type { HarnessPort, StructuredPort } from '@graphgoblin/engine';

export interface CodexStructuredOptions {
  /** Directory for calls that name none; default a fresh empty temporary directory per call. */
  workingDirectory?: string;
  /** Injected for tests. */
  tempDir?: () => Promise<{ path: string; cleanup: () => Promise<void> }>;
}

async function freshTempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'graphgoblin-structured-'));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * `StructuredPort` over Codex: one fresh thread per call with an output schema, a read-only
 * sandbox, approval `never`, no network, and no web search, so the call cannot change files.
 * Without a working directory it runs in an empty temporary directory, so the model sees no
 * project files. Schema validation stays with the engine.
 */
export class CodexStructured implements StructuredPort {
  constructor(
    private readonly harness: HarnessPort,
    private readonly options: CodexStructuredOptions = {},
  ) {}

  async complete(
    request: {
      prompt: string;
      schema: JsonSchema;
      model?: string;
      effort?: Effort;
      workingDirectory?: string;
    },
    signal: AbortSignal,
  ): Promise<{ value: unknown; usage?: Usage }> {
    const fixed = request.workingDirectory ?? this.options.workingDirectory;
    const temp = fixed ? undefined : await (this.options.tempDir ?? freshTempDir)();
    try {
      const session = this.harness.start(
        {
          workingDirectory: fixed ?? (temp as { path: string }).path,
          ...(request.model ? { model: request.model } : {}),
          ...(request.effort ? { effort: request.effort } : {}),
          options: {
            sandbox: 'read-only',
            approval: 'never',
            networkAccess: false,
            webSearch: false,
          },
          turn: { prompt: request.prompt, outputSchema: request.schema },
        },
        signal,
      );
      // Drain events so the queue does not grow unread; the result carries everything needed.
      for await (const event of session.events) void event;
      const result = await session.result;
      return {
        value: result.structured !== undefined ? result.structured : parseLoose(result.finalText),
        usage: result.usage,
      };
    } finally {
      await temp?.cleanup().catch(() => undefined);
    }
  }
}

export function createCodexStructured(
  harness: HarnessPort,
  options: CodexStructuredOptions = {},
): CodexStructured {
  return new CodexStructured(harness, options);
}
