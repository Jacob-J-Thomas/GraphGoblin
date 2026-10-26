// Check 8: an empty data directory (and a missing one) starts, creates a complete current store
// (format marker, migration ledger at the shipped head) and restarts cleanly.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  Log,
  call,
  cli,
  inspectStore,
  listDir,
  logCli,
  makeBase,
  shippedLedger,
  startApi,
  stopApi,
} from './lib.mjs';

const log = new Log('c08-fresh-init');
const base = await makeBase('c08');
log.line(`base: ${base}`);
const shipped = shippedLedger();
log.line(`shipped migrations: ${shipped.count}; head ${shipped.last.tag} (when ${shipped.last.when})`);

async function startAndInspect(label, dataDir) {
  const api = await startApi(dataDir, 6345);
  log.check(!api.failed, `${label}: API starts`, api.stderr);
  const health = await call(api, 'GET', '/healthz');
  const version = await call(api, 'GET', '/version');
  log.line(`${label}: /healthz ${health.status} ${JSON.stringify(health.body)}; /version ${JSON.stringify(version.body)}`);
  const loops = await call(api, 'GET', '/loops');
  log.check(loops.status === 200 && loops.body.items.length === 0, `${label}: empty loop list`);
  log.check((await stopApi(api)) === 0, `${label}: drains and exits 0`);
  log.line(`${label}: data directory: ${JSON.stringify(listDir(dataDir))}`);
  const store = await inspectStore(join(dataDir, 'graphgoblin.db'));
  log.line(`${label}: marker ${JSON.stringify(store.marker)}`);
  log.line(`${label}: ledger ${store.ledger.length} rows, last created_at ${store.ledger.at(-1)?.created_at}`);
  log.check(store.marker?.length === 1 && store.marker[0].format_version === 4 && store.marker[0].status === 'complete', `${label}: one complete format-4 marker`);
  log.check(store.ledger.length === shipped.count && Number(store.ledger.at(-1).created_at) === shipped.last.when, `${label}: migration ledger at the shipped head (${shipped.count} rows, last ${shipped.last.tag})`);
  return store;
}

try {
  log.section('Empty, existing data directory');
  const empty = join(base, 'empty');
  mkdirSync(empty);
  const first = await startAndInspect('first start', empty);
  const second = await startAndInspect('restart', empty);
  log.check(JSON.stringify(first.ledger) === JSON.stringify(second.ledger) && JSON.stringify(first.marker) === JSON.stringify(second.marker), 'restart leaves the marker and ledger unchanged');
  const preflight = await cli(['--preflight'], empty, {}, { timeoutMs: 60_000 });
  logCli(log, 'preflight on the fresh store', ['--preflight'], preflight);
  log.check(/ok\s+Database\s+reachable and migrated/.test(preflight.stdout), '--preflight reports the Database check ok');

  log.section('Missing data directory (two levels deep)');
  const missing = join(base, 'new', 'deeper', 'data');
  await startAndInspect('missing directory', missing);

  log.section('Reset of a fresh current store, then start again');
  const dry = await cli(['--reset'], empty);
  logCli(log, 'dry run of a fresh store', ['--reset'], dry);
  const reset = await cli(['--reset', '--yes', '--data-dir', empty], empty);
  logCli(log, 'reset of a fresh store', ['--reset', '--yes', '--data-dir', empty], reset);
  log.check(reset.code === 0, 'reset of a fresh current store completes', reset.code);
  await startAndInspect('start after reset', empty);

  log.section('Reset of an empty directory and of a missing one');
  const bare = join(base, 'bare');
  mkdirSync(bare);
  const bareReset = await cli(['--reset', '--yes', '--data-dir', bare], bare);
  logCli(log, 'reset of an empty directory', ['--reset', '--yes', '--data-dir', bare], bareReset);
  log.check(bareReset.code === 0 && JSON.stringify(listDir(bare)) === '[]', 'an empty directory resets to empty (only the lock is taken and removed)', listDir(bare));
  const gone = join(base, 'gone');
  const goneReset = await cli(['--reset', '--yes', '--data-dir', gone], gone);
  logCli(log, 'reset of a missing directory', ['--reset', '--yes', '--data-dir', gone], goneReset);
  log.check(goneReset.code === 0 && goneReset.stdout.includes('Nothing to reset'), 'a missing directory: nothing to reset, exit 0', goneReset.code);
  log.check(JSON.stringify(listDir(gone)) === '["<ENOENT>"]', 'a missing directory is not created by the reset');
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
