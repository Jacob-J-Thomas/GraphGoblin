// Exercise native fake executables through the public harnesses after pnpm build. No turns.
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeHarness } from '@graphgoblin/infrastructure/claude';
import { CodexHarness } from '@graphgoblin/adapter-codex';
const results = [];
for (const [index, harness] of ['claude', 'codex'].entries()) {
  const directory = process.argv[index + 2];
  if (!directory) throw new Error('Pass the two disposable fixture directories');
  for (const scenario of [
    'ready',
    'old',
    'missing-model',
    'missing-effort',
    'auth',
    'quota',
    'transport',
    'unknown',
    'hang',
  ]) {
    await writeFile(join(directory, 'scenario.txt'), scenario);
    const timeout = scenario === 'hang' ? 1000 : 15000;
    const adapter =
      harness === 'claude'
        ? new ClaudeHarness({ binary: join(directory, 'claude.exe'), preflightTimeoutMs: timeout })
        : new CodexHarness({
            codexBinary: join(directory, 'codex.exe'),
            preflightTimeoutMs: timeout,
          });
    const result = await adapter.preflight();
    results.push({
      harness,
      scenario,
      state: result.state,
      ok: result.ok,
      problems: result.problems,
    });
  }
  await writeFile(join(directory, 'scenario.txt'), 'ready');
}
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
