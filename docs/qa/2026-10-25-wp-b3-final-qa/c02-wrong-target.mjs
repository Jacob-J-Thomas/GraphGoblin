// Check 2: a confirmation naming another directory is refused and changes no byte; other spellings
// of the same directory (letter case, trailing separator, a junction to it, the short name, a
// relative path) are accepted as that directory, as ADR-0042 documents ("one identity").
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  Log,
  ROOT,
  cli,
  fileHash,
  listDir,
  logCli,
  makeBase,
  sameTree,
  seedDataDir,
  shortPath,
  snapshot,
} from './lib.mjs';

const log = new Log('c02-wrong-target');
const base = await makeBase('c02');
const data = join(base, 'data');
const other = join(base, 'other');
log.line(`base: ${base}`);

const refusedWithoutChange = async (label, args, env = {}, configured = data) => {
  const before = await snapshot(base);
  const result = await cli(args, configured, env);
  logCli(log, label, args, result, `GG_DATA_DIR=${configured}`);
  log.check(result.code === 1, `${label}: exit 1`, result.code);
  log.check(/reset refused: /.test(result.stderr) && /Nothing was changed\./.test(result.stderr), `${label}: refusal text and "Nothing was changed."`);
  sameTree(log, `${label}: no byte changed in data, other or the junctions`, before, await snapshot(base));
  return result;
};

try {
  await seedDataDir(data);
  await seedDataDir(other, { runId: '01JQAB3INTOTHERAAAAAAAAAAA' });
  writeFileSync(join(base, 'a-file.txt'), 'a file, not a directory');
  symlinkSync(other, join(base, 'junction-to-other'), 'junction');
  symlinkSync(data, join(base, 'junction-to-data'), 'junction');

  log.section('Refused: --yes naming another directory');
  const wrong = await refusedWithoutChange('another store', ['--reset', '--yes', '--data-dir', other]);
  log.check(wrong.stderr.includes(`--data-dir names ${other}, but this environment's data directory is ${data}`), 'message names both directories');
  await refusedWithoutChange('the parent directory', ['--reset', '--yes', '--data-dir', base]);
  await refusedWithoutChange('a subdirectory (workspaces)', ['--reset', '--yes', '--data-dir', join(data, 'workspaces')]);
  await refusedWithoutChange('the database file', ['--reset', '--yes', '--data-dir', join(data, 'graphgoblin.db')]);
  await refusedWithoutChange('a file', ['--reset', '--yes', '--data-dir', join(base, 'a-file.txt')]);
  await refusedWithoutChange('a missing directory', ['--reset', '--yes', '--data-dir', join(base, 'missing')]);
  await refusedWithoutChange('a junction to another store', ['--reset', '--yes', '--data-dir', join(base, 'junction-to-other')]);
  await refusedWithoutChange('a sibling with a longer name (data + "x")', ['--reset', '--yes', '--data-dir', data + 'x']);
  await refusedWithoutChange('the data directory with a stream suffix (data:x)', ['--reset', '--yes', '--data-dir', data + ':x']);
  await refusedWithoutChange('dry run naming another store', ['--reset', '--data-dir', other]);

  log.section('Usage errors: exit 2, nothing read or changed');
  for (const args of [
    ['--reset', '--yes'],
    ['--reset', '--yes', '--data-dir'],
    ['--reset', '--yes', '--data-dir', ''],
    ['--reset', '--yes', '--yes', '--data-dir', data],
    ['--reset', '--yes', '--data-dir', data, '--data-dir', data],
    ['--reset', '--yes', '--data-dir', '--yes'],
    ['--reset', '--yes', '--data-dir', data, 'extra'],
    ['--reset', '--force', '--data-dir', data],
  ]) {
    const before = await snapshot(base);
    const result = await cli(args, data);
    logCli(log, 'usage', args, result);
    log.check(result.code === 2 && result.stderr.includes('usage: graphgoblin-api --reset'), `exit 2 with usage for ${JSON.stringify(args.slice(1)).replaceAll(data, '<data>')}`, result.code);
    sameTree(log, 'usage error changes nothing', before, await snapshot(base));
  }

  log.section('Same directory, other spellings: the dry run accepts each and changes nothing');
  const short = shortPath(data);
  log.line(`short name of the data directory: ${short ?? '(none)'}`);
  const spellings = [
    ['upper case', data.toUpperCase()],
    ['lower case', data.toLowerCase()],
    ['trailing backslash', data + '\\'],
    ['trailing slash', data + '/'],
    ['forward slashes', data.replaceAll('\\', '/')],
    ['junction to the data directory', join(base, 'junction-to-data')],
    ['relative path from the checkout', relative(ROOT, data)],
    ['dot segments', join(data, '..', 'data') .replace(/data$/, 'other\\..\\data')],
    ...(short ? [['8.3 short name', short]] : []),
    ['--data-dir=<path> form', null],
  ];
  for (const [label, spelling] of spellings) {
    const args = spelling === null ? ['--reset', `--data-dir=${data}`] : ['--reset', '--data-dir', spelling];
    const before = await snapshot(base);
    const result = await cli(args, data);
    logCli(log, label, args, result);
    log.check(result.code === 0 && result.stdout.includes('dry run: nothing is removed'), `${label}: dry run accepted`, result.code);
    sameTree(log, `${label}: dry run changed nothing`, before, await snapshot(base));
  }

  log.section('Same directory, other spellings: the confirmed reset accepts each');
  const confirmedSpellings = [
    ['upper case', (d) => d.toUpperCase()],
    ['trailing backslash', (d) => d + '\\'],
    ['junction to the data directory', (d) => join(d, '..', 'junction-to-data')],
    ['8.3 short name', (d) => shortPath(d)],
  ];
  for (const [label, spell] of confirmedSpellings) {
    // A fresh format-3 store each time; the other store must survive every reset.
    rmSync(data, { recursive: true, force: true });
    await seedDataDir(data);
    const otherBefore = await snapshot(other);
    const key = fileHash(join(data, 'master.key'));
    const spelling = spell(data);
    if (!spelling) {
      log.line(`${label}: no spelling available, skipped`);
      continue;
    }
    const args = ['--reset', '--yes', '--data-dir', spelling];
    const result = await cli(args, data);
    logCli(log, `confirmed (${label})`, args, result);
    log.check(result.code === 0 && result.stdout.includes('Reset complete.'), `${label}: confirmed reset completes`, result.code);
    log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'workspaces']) && JSON.stringify(listDir(join(data, 'workspaces'))) === JSON.stringify(['my-notes']), `${label}: only master.key and workspaces/my-notes remain`, listDir(data));
    log.check(fileHash(join(data, 'master.key')) === key, `${label}: master.key unchanged`);
    sameTree(log, `${label}: the other store is untouched`, otherBefore, await snapshot(other));
  }

  log.section('Configured through a junction, confirmed with the physical path');
  rmSync(data, { recursive: true, force: true });
  await seedDataDir(data);
  const viaJunction = join(base, 'junction-to-data');
  const args = ['--reset', '--yes', '--data-dir', data];
  const result = await cli(args, viaJunction);
  logCli(log, 'GG_DATA_DIR is a junction', args, result, `GG_DATA_DIR=${viaJunction}`);
  log.check(result.code === 0 && result.stdout.includes(`(physical path ${data})`), 'accepted; the manifest names the physical path', result.code);

  log.section('Configured directory is a junction to another store; --data-dir names this store');
  rmSync(data, { recursive: true, force: true });
  await seedDataDir(data);
  await refusedWithoutChange('GG_DATA_DIR junction to other, --data-dir data', ['--reset', '--yes', '--data-dir', data], {}, join(base, 'junction-to-other'));
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
