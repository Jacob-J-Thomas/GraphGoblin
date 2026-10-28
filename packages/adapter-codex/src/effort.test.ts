import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EffortSchema, type Effort } from '@graphgoblin/contracts';
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

/** Run one fake-CLI turn through the public harness; return the CLI's arguments. */
async function argvFor(model: string, effort: Effort): Promise<string[]> {
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
      model,
      effort,
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: 'Controlled fixture; no provider call' },
    },
    new AbortController().signal,
  );
  await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
  return JSON.parse(await readFile(argvFile, 'utf8')) as string[];
}

const effortArguments = (argv: string[]) =>
  argv
    .filter((_arg, index) => argv[index - 1] === '--config')
    .filter((value) => value.startsWith('model_reasoning_effort='));

it.each(EffortSchema.options)(
  'sends the requested effort %s to a GPT-6 model under its canonical name',
  async (effort) => {
    const argv = await argvFor('gpt-6-luna', effort);
    expect(effortArguments(argv)).toEqual([`model_reasoning_effort="${effort}"`]);
    expect(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2)).toEqual([
      '--model',
      'gpt-6-luna',
    ]);
  },
  30_000,
);

// The owner's rule (#205, 2026-10-27): one user-facing lowest level, `none`, sent under the name
// the model's family gives it. The run records the canonical effort; only the CLI sees the name.
describe('the provider name for effort none', () => {
  it.each([
    ['gpt-6-luna', 'none'],
    ['gpt-6.1-sol', 'none'],
    ['gpt-5.6-terra', 'none'],
  ])(
    'sends none to %s as %s',
    async (model, name) => {
      expect(effortArguments(await argvFor(model, 'none'))).toEqual([
        `model_reasoning_effort="${name}"`,
      ]);
    },
    30_000,
  );

  it('sends none unchanged to a hand-added model of no known family', async () => {
    expect(effortArguments(await argvFor('house-model-7', 'none'))).toEqual([
      'model_reasoning_effort="none"',
    ]);
  }, 30_000);
});
