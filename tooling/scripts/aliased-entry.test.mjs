import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const generator = 'tooling/scripts/gen-docs.mjs';
const migrations = 'tooling/scripts/check-migrations.mjs';
const summary = 'tooling/perf/summary.mjs';
const exec = promisify(execFile);

const runNode = (cwd, args) =>
  exec(process.execPath, args, { cwd, timeout: 30_000, windowsHide: true });

async function fromCheckoutAlias(exercise) {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg-tooling-entry-'));
  const alias = join(scratch, 'checkout alias α %');
  let linked = false;
  try {
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    assert.equal(await realpath(alias), await realpath(root));
    await exercise(alias, scratch);
  } finally {
    if (linked) await unlink(alias);
    await rm(scratch, { recursive: true, force: true });
  }
}

test('reference check rejects stale output through a checkout alias', () =>
  fromCheckoutAlias(async (alias, scratch) => {
    await writeFile(join(scratch, 'api.md'), '# stale reference\n');
    await assert.rejects(runNode(alias, [generator, '--check', '--output', scratch]), {
      code: 1,
      stderr: /Generated docs are out of date:.*api\.md/s,
    });
  }));

test('migration check confirms generation through a checkout alias', () =>
  fromCheckoutAlias(async (alias) => {
    const { stdout } = await runNode(alias, [migrations]);
    assert.equal(stdout.trim(), 'Drizzle generation is a no-op.');
  }));

test('summary CLI writes compact records through a checkout alias', () =>
  fromCheckoutAlias(async (alias, scratch) => {
    const input = join(scratch, 'raw.json');
    const output = join(scratch, 'summary.json');
    await writeFile(
      input,
      JSON.stringify({
        schema: 2,
        workload: 'readiness',
        cases: [{ cli: { wallMs: 1, exitCode: 0, stdout: 'ok Database reachable and migrated' } }],
      }),
    );
    await runNode(alias, [summary, '--out=' + output, input]);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.measurements[0].workload, 'readiness');
    assert.equal(result.cases[0].preflight.databaseReady, true);
  }));

test('importing the three entry modules through a checkout alias stays inert', () =>
  fromCheckoutAlias(async (alias) => {
    const imports = [generator, migrations, summary].map((file) => {
      const url = pathToFileURL(join(alias, file)).href;
      return `await import(${JSON.stringify(url)});`;
    });
    const result = await runNode(alias, [
      '--input-type=module',
      '--eval',
      imports.join('\n'),
      '--',
      'import-probe',
      '--output',
    ]);
    assert.deepEqual(result, { stdout: '', stderr: '' });
  }));
