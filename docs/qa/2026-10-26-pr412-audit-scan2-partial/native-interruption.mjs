import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { watch, existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, inferenceLoop, contractTesting } from './audit-api.mjs';
const [, , mode, stage, directory] = process.argv;
if (mode === 'worker') {
  const api = await boot({ directory, port: 6492 });
  const loop = await api.create(inferenceLoop('Interruptible cleanup'));
  const owner = await api.run(loop);
  const keptLoop = await api.create({ ...contractTesting.minimalLoop(), name: 'Retained history' });
  const kept = await api.run(keptLoop);
  const workspace = api.harness.started[0].workingDirectory;
  const count = stage === 'partial' ? 100 : 3;
  await Promise.all(Array.from({ length: count }, (_, i) => writeFile(join(workspace, `file-${i}`), `bytes-${i}`, 'utf8')));
  await api.mark([owner.id]);
  const keptThread = (await api.request(`/runs/${kept.id}/thread`)).value;
  const beforePage = (await api.request('/runs?limit=1')).value;
  process.stdout.write(JSON.stringify({ fixture: { owner: owner.id, kept: kept.id, keptThread, beforePage, count } }) + '\n');
  const quarantine = join(directory, 'cleanup-pending');
  await mkdir(quarantine);
  let crashed = false;
  watch(quarantine, { recursive: true }, (_event, name) => {
    if (crashed || !name) return;
    const names = String(name).split(/[\\/]/);
    const target = join(quarantine, names[0]);
    let remaining;
    try { remaining = readdirSync(target).length; } catch { return; }
    const ready = stage === 'renamed' ? remaining === count : remaining > 0 && remaining < count;
    if (!ready) return;
    crashed = true;
    process.stdout.write(JSON.stringify({ crashBoundary: stage, remaining }) + '\n');
    process.kill(process.pid, 'SIGKILL');
  });
  await api.poll();
  console.log(JSON.stringify({ missedBoundary: stage }));
  await api.close();
  process.exit(2);
} else {
  for (const boundary of ['renamed', 'partial']) {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-audit-e3-crash-'));
    const child = spawn(process.execPath, ['--experimental-import-meta-resolve', fileURLToPath(import.meta.url), 'worker', boundary, dataDir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (v) => { stdout += v; });
    child.stderr.on('data', (v) => { stderr += v; });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    assert.equal(stderr, '');
    const rows = stdout.trim().split('\n').map((s) => JSON.parse(s));
    const fixture = rows.find((r) => r.fixture)?.fixture;
    const observed = rows.find((r) => r.crashBoundary);
    assert.ok(observed, stdout);
    assert.notEqual(exit.code, 0);
    const api = await boot({ directory: dataDir, port: 6492, available: 0 });
    try {
      assert.equal((await api.request(`/runs/${fixture.owner}`)).status, 404);
      assert.equal((await api.request(`/runs/${fixture.kept}`)).status, 200);
      assert.deepEqual((await api.request(`/runs/${fixture.kept}/thread`)).value, fixture.keptThread);
      assert.equal((await lstat(join(dataDir, 'workspaces', fixture.owner)).then(() => true, () => false)), false);
      const status = (await api.request('/system/storage')).value;
      assert.equal(status.pendingResources, 0);
      const page = (await api.request('/runs')).value;
      assert.deepEqual(page.items.map((r) => r.id), [fixture.kept]);
      assert.equal(page.items[0].deletionApproval, undefined);
      console.log(JSON.stringify({ scenario: 'native API crash and reopen', boundary, exit, remainingAtCrash: observed.remaining, approvedRunGone: true, retainedThreadUnchanged: true, pageIdsConsistent: true, status }));
    } finally { await api.close(); }
  }
}
