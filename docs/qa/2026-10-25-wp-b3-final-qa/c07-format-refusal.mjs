// Check 7: a format-3 store and an unmarked store refuse startup (exit 1, the documented message,
// no change to the store's bytes); --preflight reports a failed Database check; importing a loop
// export or bare definition of another format answers 400 LOOP_FORMAT_UNSUPPORTED and saves nothing.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOOP,
  Log,
  call,
  cli,
  diff,
  inspectStore,
  logCli,
  makeBase,
  sameTree,
  seedDataDir,
  seedStore,
  snapshot,
  startApi,
  stopApi,
} from './lib.mjs';

const log = new Log('c07-format-refusal');
const base = await makeBase('c07');
log.line(`base: ${base}`);

const expectedRefusal = (dataDir, found, reason, damaged = false) =>
  [
    `GraphGoblin did not start: this build cannot open the store in data directory ${dataDir}.`,
    `  Database: ${join(dataDir, 'graphgoblin.db')}`,
    `  Found:    ${found}`,
    '  Requires: format 4',
    `  Reason:   ${reason}`,
    'No stored data was changed. This build does not convert stores from other formats.',
    damaged
      ? 'Repair the store by hand, or start fresh: stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):'
      : 'To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):',
    `  node apps/api/dist/main.js --reset --data-dir "${dataDir}"`,
    '',
  ].join('\n');

async function refusedStore(label, dataDir, found, reasonPattern) {
  const before = await snapshot(dataDir);
  const started = await cli([], dataDir, { GG_PORT: '6343' }, { timeoutMs: 60_000 });
  logCli(log, `${label}: start`, [], started);
  log.check(started.code === 1, `${label}: startup exits 1`, started.code);
  const reason = /Reason:   (.*)\n/.exec(started.stderr)?.[1] ?? '';
  log.check(reasonPattern.test(reason), `${label}: reason`, reason);
  log.check(started.stderr === expectedRefusal(dataDir, found, reason), `${label}: the documented message, exactly, with no stack trace`);
  const after = await snapshot(dataDir);
  const changed = diff(before, after);
  const onlyShm = [...changed.removed, ...changed.added].every((r) => /^F graphgoblin\.db-shm /.test(r));
  log.check(onlyShm, `${label}: no stored byte changed (the -shm index excepted, as documented)`, changed);
  log.line(`${label}: -shm changed: ${changed.added.length > 0}`);
  const preflightBefore = await snapshot(dataDir);
  const preflight = await cli(['--preflight'], dataDir, {}, { timeoutMs: 60_000 });
  logCli(log, `${label}: preflight`, ['--preflight'], preflight);
  log.check(preflight.code === 1, `${label}: --preflight exits 1`, preflight.code);
  log.check(new RegExp(`FAIL\\s+Database\\s+${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Start refuses this store and converts nothing; to start fresh, list what a reset removes with node apps/api/dist/main.js --reset --data-dir "${dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(preflight.stdout + preflight.stderr), `${label}: --preflight reports a failed Database check naming the reset dry run`);
  const afterPreflight = await snapshot(dataDir);
  const changed2 = diff(preflightBefore, afterPreflight);
  log.check([...changed2.removed, ...changed2.added].every((r) => /^F graphgoblin\.db-shm /.test(r)), `${label}: --preflight changed no stored byte`, changed2);
  sameTree(log, `${label}: run workspace, artifacts and master.key untouched by start and preflight`, before.filter((r) => !/graphgoblin\.db/.test(r) && !/^D \.?\/? /.test(r)), afterPreflight.filter((r) => !/graphgoblin\.db/.test(r) && !/^D \.?\/? /.test(r)));
}

try {
  log.section('Format-3 store');
  const f3 = join(base, 'format3');
  await seedDataDir(f3);
  await refusedStore('format 3', f3, 'format 3', /^The store is format 3; this build reads only format 4$/);

  log.section('Unmarked store (no gg_upgrade_state table)');
  const unmarked = join(base, 'unmarked');
  await seedDataDir(unmarked, { format: 4 });
  rmSync(join(unmarked, 'graphgoblin.db'));
  rmSync(join(unmarked, 'graphgoblin.db-wal'), { force: true });
  rmSync(join(unmarked, 'graphgoblin.db-shm'), { force: true });
  await seedStore(join(unmarked, 'graphgoblin.db'), { runIds: ['01JQAB3INTRUNAAAAAAAAAAAAA'], dropMarker: true });
  log.line(`unmarked store tables: ${JSON.stringify((await inspectStore(join(unmarked, 'graphgoblin.db'))).tables)}`);
  await refusedStore('unmarked', unmarked, 'no valid format marker', /marker/i);

  log.section('Imports of another format (fresh API on port 6344)');
  const fresh = join(base, 'fresh');
  const api = await startApi(fresh, 6344);
  log.check(!api.failed, 'fresh API starts', api.stderr);
  const bodies = [
    ['export envelope, formatVersion 3', { format: 'graphgoblin-loop', formatVersion: 3, exportedAt: 'x', loop: {} }, 3, 'export'],
    ['bare format-2 definition', { schemaVersion: 2, name: 'old', nodes: [], edges: [] }, 2, 'definition'],
    ['bare format-2 definition with a format-2 node shape', { schemaVersion: 2, name: 'old', nodes: [{ id: 't', type: 'trigger', data: {} }], edges: [] }, 2, 'definition'],
    ['format-4 envelope holding a format-3 loop', { format: 'graphgoblin-loop', formatVersion: 4, exportedAt: 'x', loop: { ...LOOP, schemaVersion: 3 } }, 3, 'export'],
    ['export envelope, formatVersion 5 (newer)', { format: 'graphgoblin-loop', formatVersion: 5, exportedAt: 'x', loop: LOOP }, 5, 'export'],
  ];
  for (const [label, body, found, document] of bodies) {
    const response = await call(api, 'POST', '/loops/import', body);
    log.line(`POST /loops/import (${label}) -> ${response.status} ${JSON.stringify(response.body)}`);
    log.check(
      response.status === 400 &&
        response.body.code === 'LOOP_FORMAT_UNSUPPORTED' &&
        response.body.errors?.foundFormat === found &&
        response.body.errors?.requiredFormat === 4 &&
        response.body.detail === `This loop ${document} is format ${found}; this build reads only format 4 and does not convert other formats. Re-create the loop in this build, or export it again from a build that writes format 4.`,
      `${label}: 400 LOOP_FORMAT_UNSUPPORTED with foundFormat ${found}, requiredFormat 4 and the documented detail`,
    );
  }
  const stringVersion = await call(api, 'POST', '/loops/import', { format: 'graphgoblin-loop', formatVersion: '3', exportedAt: 'x', loop: {} });
  log.line(`POST /loops/import (formatVersion "3" as a string) -> ${stringVersion.status} ${JSON.stringify(stringVersion.body).slice(0, 400)}`);
  log.check(stringVersion.status === 400, 'a non-numeric formatVersion is refused with 400 (not converted)', stringVersion.body.code);
  const list = await call(api, 'GET', '/loops');
  log.check(list.status === 200 && list.body.items.length === 0, 'nothing was saved by the refused imports', list.body.items?.length);
  const ok = await call(api, 'POST', '/loops/import', { format: 'graphgoblin-loop', formatVersion: 4, exportedAt: '2026-10-25T00:00:00.000Z', loop: LOOP });
  log.line(`POST /loops/import (current format control) -> ${ok.status}`);
  log.check(ok.status === 201, 'control: a current-format export imports (201)', ok.status);
  log.check((await stopApi(api)) === 0, 'API drains and exits 0');
  const store = await inspectStore(join(fresh, 'graphgoblin.db'));
  log.check(store.loops === 1, 'the store holds exactly the one control loop', store.loops);
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
