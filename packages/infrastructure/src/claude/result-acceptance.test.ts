import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { ClaudeHarness } from './harness.js';
import type { ClaudeCliRunner, ClaudeProcessResult } from './process.js';

const id = '11111111-1111-4111-8111-111111111111';
const outcome: ClaudeProcessResult = {
  exitCode: 0,
  stdout: '',
  aborted: false,
  timedOut: false,
  overflow: false,
};
const help =
  '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume';

it.each(['resume-previous', 'resume-named'] as const)(
  'persists result-only acceptance under %s while process exit is still pending',
  async (policy) => {
    const e = await createTestEngine();
    let release!: () => void;
    const exit = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed!: () => void;
    const received = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const runner: ClaudeCliRunner = async (request, onStdout) => {
      if (request.args.includes('--version')) return { ...outcome, stdout: '2.1.304' };
      if (request.args.includes('--help')) return { ...outcome, stdout: help };
      if (request.args.includes('auth'))
        return { ...outcome, stdout: '{"authMethod":"claude.ai"}' };
      onStdout?.(
        Buffer.from(
          JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: id,
            tools: ['Read', 'Glob', 'Grep'],
            permissionMode: 'dontAsk',
            model: 'claude-opus-5-5',
            apiKeySource: 'none',
            mcp_servers: [],
            plugins: [],
            skills: [],
          }) + '\n',
        ),
      );
      onStdout?.(
        Buffer.from(
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            session_id: id,
            result: request.stdin,
            usage: { input_tokens: 2, output_tokens: 3 },
            modelUsage: { 'claude-opus-5-5': {} },
          }) + '\n',
        ),
      );
      if (request.stdin === 'Task B') {
        observed();
        await exit;
      }
      return outcome;
    };
    e.ports.harnesses.claude = new ClaudeHarness({ runner, platform: 'win32' });
    e.ports.modelCatalog.entries.push({
      harness: 'claude',
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Opus',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const config = {
      harness: 'claude' as const,
      model: 'claude-opus-5-5',
      effort: 'low' as const,
      harnessOptions: { sandbox: 'read-only' as const, approval: 'never' as const },
    };
    const definition = singleNodeLoop('result acceptance-' + policy, {
      id: 'a',
      kind: 'inference',
      label: 'A',
      config: {
        ...config,
        prompt: { template: 'Task A' },
        session: { policy: 'resume-named', key: 'shared' },
      },
    });
    definition.nodes.splice(2, 0, {
      id: 'b',
      kind: 'inference',
      label: 'B',
      config: {
        ...config,
        prompt: { template: 'Task B' },
        session: policy === 'resume-named' ? { policy, key: 'shared' } : { policy },
      },
    });
    definition.edges[1]!.to.node = 'b';
    definition.edges.push({ id: 'b-out', from: { node: 'b', port: 'out' }, to: { node: 'done' } });
    try {
      const version = e.publish(definition);
      const run = await e.start(version.loopId);
      await received;
      await vi.waitFor(
        () =>
          expect(e.events(run.id)).toContainEqual(
            expect.objectContaining({
              type: 'harness.submission',
              nodeId: 'b',
              submission: 'submitted',
              marker: 'claude.result',
            }),
          ),
        { timeout: 1000 },
      );
      const before = e.events(run.id).filter((event) => 'nodeId' in event && event.nodeId === 'b');
      const turn = before.find((event) => event.type === 'harness.turn');
      expect(before.find((event) => event.type === 'harness.submission')).toMatchObject({
        visitId: turn?.visitId,
        turnId: turn?.turnId,
      });
      expect(before.some((event) => ['harness.usage', 'node.finished'].includes(event.type))).toBe(
        false,
      );
      expect((await e.manager.getThread(run.id))?.outputs.b).toBeUndefined();
      release();
      expect((await e.settle(run.id)).status).toBe('succeeded');
      const after = e.events(run.id).filter((event) => 'nodeId' in event && event.nodeId === 'b');
      expect(after.filter((event) => event.type === 'harness.submission')).toHaveLength(1);
      expect(after.findIndex((event) => event.type === 'harness.submission')).toBeLessThan(
        after.findIndex((event) => event.type === 'harness.usage'),
      );
    } finally {
      release();
      await e.manager.waitForIdle();
      e.manager.stop();
    }
  },
);
