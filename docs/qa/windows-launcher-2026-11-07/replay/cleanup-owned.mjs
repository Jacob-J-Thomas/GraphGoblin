// Managed API cleanup of retained disposable QA stores only; never kills a PID or deletes files.
import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2]);
assert.ok(relative(root, target).startsWith('run-') && !relative(root, target).includes('..'));
const results = [];
for (const entry of await readdir(target, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let c, owner;
  try { c = JSON.parse(await readFile(join(target, entry.name, 'GraphGoblin.exe.json'), 'utf8'));
    assert.ok(relative(root, resolve(c.DataDir)) && !relative(root, resolve(c.DataDir)).startsWith('..'));
    assert.ok(c.Port >= 4860 && c.Port <= 4879);
    owner = JSON.parse(await readFile(join(c.DataDir, 'graphgoblin.lock'), 'utf8'));
  } catch { continue; }
  const row = { directory: entry.name, port: c.Port, lockPid: owner.pid };
  try {
    const health = await fetch(`http://127.0.0.1:${c.Port}/healthz`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(3000) });
    const pid = Number(health.headers.get('x-graphgoblin-pid')); row.healthPid = pid;
    assert.equal(pid, owner.pid, 'Health PID differs from this explicit disposable lock');
    assert.ok(health.headers.get('x-graphgoblin-instance'));
    const stop = await fetch(`http://127.0.0.1:${c.Port}/system/shutdown`, { method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ action: 'force' }), signal: AbortSignal.timeout(5000) });
    assert.equal(stop.status, 202); row.shutdown = await stop.json();
    const deadline = Date.now() + 10_000;
    while (await access(join(c.DataDir, 'graphgoblin.lock')).then(() => true, () => false)) {
      assert.ok(Date.now() < deadline, 'Managed cleanup did not release lock');
      await new Promise((done) => setTimeout(done, 100));
    }
    row.result = 'managed-force-and-lock-release';
  } catch (e) { row.result = 'retained-unmodified'; row.error = e.message; }
  results.push(row);
}
await writeFile(join(target, `managed-cleanup-${Date.now()}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
