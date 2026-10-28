/**
 * The built API refuses an unsupported `GG_DEFAULTS` effort at startup with an operator message,
 * not a stack trace (#205 QA Q205-2): the code, the harness, the field, the configured model and
 * effort, and the way out, before anything is written to the data directory.
 */
import { access } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { createApiProcessFixture } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.dispose();
}, 60_000);

it.each([
  ['codex', 'gpt-5.5'],
  ['claude', 'claude-haiku-5-5'],
] as const)(
  'prints the GG_DEFAULTS %s effort refusal without a stack and exits 1',
  async (harness, model) => {
    const f = await createApiProcessFixture();
    fixtures.push(f);
    const child = f.run([], {
      GG_DEFAULTS: JSON.stringify({ byHarness: { [harness]: { model, effort: 'none' } } }),
    });
    const { code } = await child.waitForExit();
    expect(code).toBe(1);
    expect(child.stderr.trim().split(/\r?\n/)).toEqual([
      'GraphGoblin did not start: Invalid GG_DEFAULTS (EVALUATION_INVALID_CONFIGURATION).',
      `  ${harness}: EFFORT_UNSUPPORTED at effort (model "${model}", effort "none"): The default reasoning effort is not supported by its model.`,
      'No stored data was changed. Set GG_DEFAULTS to a model and effort the model catalog lists, or remove it, then start again.',
    ]);
    await expect(access(f.databaseFile)).rejects.toThrow();
  },
  60_000,
);
