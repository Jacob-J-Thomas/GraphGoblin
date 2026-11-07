// Independent public-API fixture; writes only explicitly supplied disposable fixture files.
// Usage after launcher readiness: node providerfree-workload.mjs prepare|snapshot|release ORIGIN DIRECTORY
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [action, inputOrigin, inputDirectory] = process.argv.slice(2);
assert.ok(['prepare', 'snapshot', 'release'].includes(action), 'Expected prepare, snapshot or release');
const origin = new URL(inputOrigin);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
assert.ok(Number(origin.port) >= 4860 && Number(origin.port) <= 4879, 'Only disposable ports4860-4879');
const root = dirname(fileURLToPath(import.meta.url));
const directory = resolve(inputDirectory);
const relation = relative(root, directory);
assert.ok(relation && !relation.startsWith('..') && !relation.includes(':'), 'Directory must be under independent-qa');
const manifestFile = join(directory, 'workload.json');
await mkdir(directory, { recursive: true });

async function call(method, path, body) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function until(check, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < end, 'Timed out waiting for fixture state');
    await new Promise((done) => setTimeout(done, 50));
  }
}
function definition(name, work) {
  const nodes = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    ...work,
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ];
  return { schemaVersion: 4, name, nodes, edges: nodes.slice(1).map((node, i) => ({
    id: `e${i}`, from: { node: nodes[i].id, port: 'out' }, to: { node: node.id },
  })) };
}
async function publish(value) {
  const created = await call('POST', '/loops', { definition: value });
  const loopId = created.loop.id;
  await call('POST', `/loops/${loopId}/publish`);
  return loopId;
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

if (action === 'prepare') {
  const release = join(directory, 'release');
  const pids = join(directory, 'script-pids.json');
  const rootScript = `const fs=require('node:fs');const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify("setInterval(()=>{},1000)")}],{stdio:'inherit',windowsHide:true});fs.writeFileSync(${JSON.stringify(pids)},JSON.stringify({root:process.pid,descendant:child.pid}));const tick=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(tick);child.kill();child.once('close',()=>process.exit(0));}},50);setTimeout(()=>{child.kill();process.exit(4)},240000);`;
  const childLoop = await publish(definition('Independent launcher native child', [{
    id: 'hold', kind: 'script', label: 'Held native tree',
    config: { command: process.execPath, args: ['-e', rootScript] },
  }]));
  const parentLoop = await publish(definition('Independent launcher parent', [{
    id: 'child', kind: 'subloop', label: 'Required child', config: { loopRef: { loopId: childLoop } },
  }]));
  const started = await call('POST', `/loops/${parentLoop}/runs`, {});
  const parentId = started.run.id;
  let childId;
  await until(async () => {
    const run = await call('GET', `/runs/${parentId}`);
    childId = run.waiting?.childRunId;
    return !!childId;
  });
  let tree;
  await until(async () => {
    try { tree = JSON.parse(await readFile(pids, 'utf8')); return alive(tree.root) && alive(tree.descendant); }
    catch { return false; }
  });
  const manifest = { origin: origin.origin, directory, parentLoop, childLoop, parentId, childId,
    release, pids, tree, preparedAt: new Date().toISOString() };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
} else {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  assert.equal(manifest.origin, origin.origin);
  if (action === 'release') await writeFile(manifest.release, 'complete');
  const parent = await call('GET', `/runs/${manifest.parentId}`);
  const child = await call('GET', `/runs/${manifest.childId}`);
  const tree = Object.fromEntries(Object.entries(manifest.tree).map(([key, pid]) => [key, { pid, alive: alive(pid) }]));
  const snapshot = { at: new Date().toISOString(), parent, child, tree };
  await writeFile(join(directory, `${action}-${Date.now()}.json`), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify(snapshot));
}
