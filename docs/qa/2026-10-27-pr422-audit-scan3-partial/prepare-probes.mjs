import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const repo = process.cwd();
const prior = process.env.GG_PRIOR_QA;
const write = (name, value) => fs.writeFileSync(path.join(out, name), value, 'utf8');
let snapshot = fs.readFileSync(path.join(repo, 'docs/qa/2026-10-25-wp-d5-256/scan-2/snapshot-probe.mjs'), 'utf8');
snapshot = snapshot.replace('gg-wp-d5-scan2-snapshot-', 'gg-audit-422r3-snapshot-').replace('[0, 1000, 10000]', '[0, 1000, 10000, 100000]');
snapshot = snapshot.replace('const snapshotReads = reads;', `const snapshotReads = reads;
    assert(snapshotReads.every(r => r.method === 'recoveryFacts' && r.rows <= 3));
    assert.equal(snapshotReads.length, 1);
    assert.equal(snapshotReads[0].observedSeq, response.json().lastEventSeq);
    const full = await base.ports.events.read(started.id);
    const reached = [...new Set(full.filter(e => e.type === 'node.started').map(e => e.nodeId))];
    assert.deepEqual([...snapshotReads[0].reachedNodeIds].sort(), reached.sort());`);
write('snapshot-probe.mjs', snapshot);
for (const name of ['lib.mjs', 'build-baseline.mjs', 'baseline-loader.mjs', 'baseline-entry.mjs', 'upgrade.mjs', 'effect.mjs']) {
  let source = fs.readFileSync(path.join(prior, name), 'utf8');
  if (name === 'lib.mjs') source = source
    .replace("path.resolve(RECORD, '../../..')", 'path.resolve(process.env.GG_AUDIT_REPO)')
    .replace("'gg-qa-422-'", "'gg-audit-422r3-'")
    .replace('port = 6660', 'port = 6654').replace('port < 6660 || port > 6669', 'port < 6650 || port > 6659')
    .replace("GG_TEST_PORT_START: '6970'", "GG_TEST_PORT_START: '6930'")
    .replace("GG_TEST_PORT_COUNT: '30'", "GG_TEST_PORT_COUNT: '40'")
    .replace('...env,\n    },', 'GG_AUDIT_REPO: REPO,\n      ...env,\n    },');
  if (name === 'build-baseline.mjs') source = source.replace("import ts from '../../../node_modules/typescript/lib/typescript.js';", "import { createRequire } from 'node:module';\nconst ts = createRequire(path.join(process.env.GG_AUDIT_REPO, 'package.json'))('typescript');");
  if (name === 'baseline-loader.mjs') source = source.replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')", 'path.resolve(process.env.GG_AUDIT_REPO)');
  if (name === 'upgrade.mjs') source = source.replaceAll('6662', '6654')
    .replace('adds one ledger entry', 'and 0025 add two ledger entries')
    .replace('E.oldLedger.length + 1', 'E.oldLedger.length + 2')
    .replace('second reopen does not reapply 0024', 'second reopen does not reapply 0024 or 0025');
  write(name, source);
}
const req = createRequire(path.join(repo, 'package.json'));
const ts = req('typescript');
let native = fs.readFileSync(path.join(repo, 'apps/web/e2e/script-recovery.spec.ts'), 'utf8');
native = native.replace('port = 6371; port <= 6389', 'port = 6652; port <= 6653')
  .replace('6371..6389', '6652..6653').replace('gg-wp-d5-script-browser-', 'gg-audit-422r3-script-browser-')
  .replace("import { test, expect } from '@playwright/test';", "import { createRequire } from 'node:module';\nimport { resolve } from 'node:path';\nconst repo = process.env.GG_AUDIT_REPO;\nconst {test,expect} = createRequire(resolve(repo, 'apps/web/package.json'))('@playwright/test');")
  .replace("import { CURRENT_DEFINITION_FORMAT, type RunRecord } from '@graphgoblin/contracts';", "import { pathToFileURL } from 'node:url';\nconst {CURRENT_DEFINITION_FORMAT} = await import(pathToFileURL(resolve(repo, 'packages/contracts/dist/index.js')).href);")
  .replace("fileURLToPath(new URL('../../api/', import.meta.url))", "resolve(repo, 'apps/api')")
  .replace("fileURLToPath(new URL('../dist/', import.meta.url))", "resolve(repo, 'apps/web/dist')");
write('native-browser.spec.mjs', ts.transpileModule(native, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
write('native-browser.config.mjs', `import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {defineConfig}=createRequire(resolve(process.env.GG_AUDIT_REPO,'apps/web/package.json'))('@playwright/test');
export default defineConfig({testDir:dirname(fileURLToPath(import.meta.url)),testMatch:'native-browser.spec.mjs',workers:1,retries:0,reporter:'list',outputDir:resolve(dirname(fileURLToPath(import.meta.url)),'native-browser-results'),use:{channel:'msedge',headless:true,trace:'off'}});
`);
console.log('Prepared report-local probes; copied scenario assertions, only isolation/resolution adaptations and expanded size/parity assertions.');
