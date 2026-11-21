// Isolated observation driver (evidence only, never part of the repository). It records the public
// ClaudeHarness preflight facts and turn refusal for the combined F1/F2 cases with a scripted
// runner (controlled runner seam: no process, provider or model turn). Output: OBSERVE_OUT file.
import { writeFileSync } from 'node:fs';
import { ClaudeHarness } from '../../../gg-i4-364-claude-start/GraphGoblin/packages/infrastructure/src/claude/harness.ts';

type Result = Record<string, unknown>;
const help =
  '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume';
const outcome = (stdout = '', extra: Result = {}): Result => ({
  stdout,
  exitCode: 0,
  aborted: false,
  timedOut: false,
  overflow: false,
  ...extra,
});
const AUTH_BODY = '{"authMethod":"claude.ai","email":"authentication@example.invalid';
const cases: Record<string, { help?: Result; auth?: Result }> = {
  'F1 auth-like partial stdout, output lost, exit 1': {
    auth: outcome(AUTH_BODY, { exitCode: 1, outputFailed: true }),
  },
  'F1 auth-like partial stdout, output lost, exit null': {
    auth: outcome(AUTH_BODY, { exitCode: null, outputFailed: true }),
  },
  'F1 classified auth stderr, output lost, exit 1': {
    auth: outcome('', { exitCode: 1, outputFailed: true, failureState: 'auth' }),
  },
  'F2 help-only refusal, check folder missing': {
    help: outcome('', { exitCode: null, spawnCode: 'ENOENT', startRefusal: 'working-directory-missing' }),
  },
  'F2 help-only output lost, exit 0': { help: outcome(help.slice(0, 20), { outputFailed: true }) },
};
it('records public facts for the combined cases', async () => {
  const records: unknown[] = [];
  for (const [name, results] of Object.entries(cases)) {
    const commands: string[][] = [];
    const harness = new ClaudeHarness({
      platform: 'win32',
      binary: 'observe-claude',
      runner: async (command) => {
        await Promise.resolve();
        commands.push([...command.args]);
        if (command.args.includes('--version')) return outcome('2.1.285 (Claude Code)') as never;
        if (command.args.includes('--help')) return (results.help ?? outcome(help)) as never;
        if (command.args.includes('auth'))
          return (results.auth ?? outcome('{"authMethod":"claude.ai"}')) as never;
        throw new Error('a model turn must not start');
      },
    });
    const { models: _models, supportedPolicies: _policies, ...facts } = await harness.preflight();
    const session = harness.start(
      {
        workingDirectory: 'observe-workspace',
        model: 'claude-opus-5-5',
        effort: 'xhigh',
        options: { sandbox: 'read-only', approval: 'never' } as never,
        turn: { prompt: 'observe prompt' },
      },
      new AbortController().signal,
    );
    const events: unknown[] = [];
    for await (const event of session.events) events.push(event);
    const turn = await session.result.then(
      () => ({ resolved: true }),
      (error: { code?: string; message?: string; retriable?: boolean }) => ({
        code: error.code,
        message: error.message,
        retriable: error.retriable,
      }),
    );
    records.push({
      case: name,
      preflight: facts,
      hasAuthenticatedProperty: 'authenticated' in facts,
      turn,
      events,
      turnProcessStarted: commands.some((args) => args.includes('--print')),
    });
  }
  writeFileSync(process.env.OBSERVE_OUT ?? 'observe-out.json', JSON.stringify(records, null, 2) + '\n');
});
