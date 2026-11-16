// Reviewer-local driver: create a junction inside this diag directory only, run the probe through
// real and aliased paths, then unlink the junction (never recursive removal). No product code runs.
import { execFileSync } from 'node:child_process';
import { lstatSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const real = join(here, 'probe-real');
const alias = join(here, 'probe-alias junction α');
const results = { node: process.version, platform: process.platform, cases: {} };
const run = (name, args, cwd) => {
  results.cases[name] = JSON.parse(execFileSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true }));
};
symlinkSync(real, alias, 'junction');
try {
  const st = lstatSync(alias);
  results.alias = { path: alias, isSymbolicLink: st.isSymbolicLink(), target: readlinkSync(alias), realpath: realpathSync(alias) };
  if (realpathSync(alias) !== realpathSync(real)) throw new Error('Probe alias does not resolve to probe-real.');
  run('direct-absolute', [join(real, 'probe.mjs')], real);
  run('direct-relative', ['probe.mjs'], real);
  run('alias-absolute', [join(alias, 'probe.mjs')], alias);
  run('alias-relative', ['probe.mjs'], alias);
  run('eval-import-alias-url', ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(join(alias, 'probe.mjs')).href], alias);
  run('eval-import-no-argv', ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(alias, 'probe.mjs')).href)})`], alias);
} finally {
  unlinkSync(alias);
  results.aliasUnlinked = true;
}
const out = JSON.stringify(results, null, 2) + '\n';
writeFileSync(join(here, 'node-entry-guard-probe.json'), out);
process.stdout.write(out);
