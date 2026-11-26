// Hold a GraphGoblin lock through the built lock module until stdin says "release".
// Usage: node hold-lock.mjs <worktree> <data|database> <dataDir|databaseFile>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worktree, kind, target] = process.argv.slice(2);
const mod = await import(pathToFileURL(join(worktree, 'apps/api/dist/data-dir-lock.js')).href);
const lock = kind === 'data' ? await mod.acquireDataDirLock(target) : await mod.acquireDatabaseLock(target);
process.stdout.write('held\n');
let input = '';
const timer = setTimeout(async () => {
  process.stderr.write('timeout; releasing\n');
  process.stdout.write(`release:${await lock.release()}\n`);
  process.exit(3);
}, 300_000);
process.stdin.on('data', async (chunk) => {
  input += chunk;
  if (!input.includes('release')) return;
  clearTimeout(timer);
  process.stdout.write(`release:${await lock.release()}\n`);
  process.exit(0);
});
