import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessId, HarnessPreflight, LoopIssue } from '@graphgoblin/contracts';
import { cliFailureState, readinessMessage } from '@graphgoblin/domain';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { ClaudeHarness } from '@graphgoblin/infrastructure/claude';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CLI evidence through Settings preflight and draft validation', () => {
  it.each([
    ['auth-network', 'auth'],
    ['quota-network', 'quota'],
    ['stdout-quota-warning', 'quota'],
    ['auth-empty', 'unknown'],
    ['auth-unrecognised', 'unknown'],
    ['auth-zero-stdout', 'auth'],
    ['auth-zero-stderr', 'auth'],
    ['ready', 'ready'],
    ['auth', 'auth'],
  ] as const)(
    '%s preserves %s for both harnesses',
    async (scenario, state) => {
      const problem = (id: HarnessId) =>
        readinessMessage(
          id,
          state,
          state === 'auth' &&
            (scenario.startsWith('auth-zero') || (scenario === 'auth' && id === 'claude'))
            ? `${id === 'claude' ? 'Claude' : 'Codex'} is not signed in.`
            : undefined,
        );
      const commands: { harness: HarnessId; args: readonly string[] }[] = [];
      async function executable(harness: HarnessId, args: readonly string[], cwd: string) {
        commands.push({ harness, args });
        const fixture = fileURLToPath(
          new URL(
            harness === 'claude'
              ? '../../../packages/infrastructure/src/claude/fixtures/readiness-cli.mjs'
              : '../../../packages/adapter-codex/src/fixtures/readiness-cli.mjs',
            import.meta.url,
          ),
        );
        const child = spawn(process.execPath, [fixture, scenario, ...args], {
          cwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        const [code] = await once(child, 'close');
        return { code: typeof code === 'number' ? code : null, stdout, stderr };
      }
      const claude = new ClaudeHarness({
        platform: 'win32',
        runner: async (request) => {
          const result = await executable('claude', request.args, request.cwd);
          return {
            exitCode: result.code,
            stdout: result.stdout,
            timedOut: false,
            aborted: false,
            overflow: false,
            // The public process port carries bounded stderr classification, as the real runner does.
            ...(result.code !== 0 && result.stderr
              ? { failureState: cliFailureState(result.stderr) }
              : {}),
            ...(request.classifyDiagnostics && /\bnot logged in\b/i.test(result.stderr.slice(-8192))
              ? { notLoggedIn: true as const }
              : {}),
          };
        },
      });
      const codex = new CodexHarness({
        codexBinary: process.execPath,
        cliRunner: async (cli, args) => {
          const result = await executable('codex', args, cli.cwd!);
          return {
            code: result.code,
            output: result.stdout + result.stderr,
            stdout: result.stdout,
          };
        },
      });
      app = await createTestApp({ harnesses: { claude, codex } });
      const settingsBefore = await app.app.inject('/settings');
      const response = await app.app.inject('/harness/preflight');
      expect(response.statusCode).toBe(200);
      const items = response.json<{ items: (HarnessPreflight & { harness: HarnessId })[] }>().items;
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item).toMatchObject({ state, ok: state === 'ready' });
        if (state === 'unknown') {
          expect(item).not.toHaveProperty('authenticated');
          expect(item.problems).toEqual([readinessMessage(item.harness, 'unknown')]);
        }
        if (state === 'auth') expect(item.problems).toEqual([problem(item.harness)]);
        if (scenario === 'ready' || scenario === 'auth')
          expect(item.authenticated).toBe(scenario === 'ready');
        if (scenario.startsWith('auth-zero')) expect(item.authenticated).toBe(false);
      }
      const preflight = await app.app.inject('/system/preflight');
      expect(preflight.statusCode).toBe(200);
      for (const id of ['claude', 'codex'] as const) {
        expect(preflight.json()).toMatchObject({
          checks: expect.arrayContaining([expect.objectContaining({ id: 'harness.' + id, state })]),
        });
        const definition = singleNodeLoop('Evidence', {
          id: 'work',
          kind: 'inference',
          label: 'Work',
          config: {
            harness: id,
            model: id === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
            effort: 'high',
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
            prompt: { template: 'No turn' },
          },
        });
        const beforeDraft = commands.length;
        const created = await app.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition },
        });
        expect(created.statusCode).toBe(201);
        expect(commands).toHaveLength(beforeDraft);
        const { loop } = created.json<{ loop: { id: string } }>();
        const validated = await app.app.inject({
          method: 'POST',
          url: `/loops/${loop.id}/validate`,
          payload: { definition },
        });
        expect(validated.statusCode).toBe(200);
        const issues = validated
          .json<{ issues: LoopIssue[] }>()
          .issues.filter((issue) => issue.code.startsWith('HARNESS_READINESS_'));
        if (state === 'ready') expect(issues).toEqual([]);
        else
          expect(issues).toEqual([
            expect.objectContaining({
              code: 'HARNESS_READINESS_' + state.toUpperCase(),
              nodeId: 'work',
              ...(['unknown', 'auth'].includes(state) ? { message: problem(id) } : {}),
            }),
          ]);
      }
      expect((await app.app.inject('/settings')).body).toBe(settingsBefore.body);
      expect((await app.app.inject('/runs')).json().items).toEqual([]);
      expect(
        commands.every(
          ({ args }) =>
            args.includes('--version') || args.includes('--help') || args.includes('status'),
        ),
      ).toBe(true);
    },
    60000,
  );
});
