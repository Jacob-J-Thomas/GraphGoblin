import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EffortSchema } from '@graphgoblin/contracts';
import { CodexHarness } from './harness.js';

// The real SDK spawns `<codexBinary> exec ...`. This Node executable with the preloaded fake CLI
// records the arguments the Codex CLI would receive, so the assertion covers the SDK's own
// argument building as well as the adapter's options.
const preload = new URL('./fixtures/argv-cli.mjs', import.meta.url).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(entry[0]),
  ),
);

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

it.each(EffortSchema.options)(
  'sends the requested effort %s to the Codex CLI unchanged',
  async (effort) => {
    const directory = await mkdtemp(join(tmpdir(), 'gg-codex-argv-'));
    directories.push(directory);
    const argvFile = join(directory, 'argv.json');
    const harness = new CodexHarness({
      codexBinary: process.execPath,
      env: { ...inherited, NODE_OPTIONS: `--import=${preload}`, GG_FAKE_CODEX_ARGV: argvFile },
    });
    const session = harness.start(
      {
        workingDirectory: directory,
        model: 'gpt-6-luna',
        effort,
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'Controlled fixture; no provider call' },
      },
      new AbortController().signal,
    );
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    const argv = JSON.parse(await readFile(argvFile, 'utf8')) as string[];
    const overrides = argv.filter((_arg, index) => argv[index - 1] === '--config');
    expect(overrides.filter((value) => value.startsWith('model_reasoning_effort='))).toEqual([
      `model_reasoning_effort="${effort}"`,
    ]);
    expect(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2)).toEqual([
      '--model',
      'gpt-6-luna',
    ]);
  },
  30_000,
);
