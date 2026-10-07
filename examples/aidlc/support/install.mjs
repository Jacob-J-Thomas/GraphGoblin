import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..');
const api = 'http://127.0.0.1:4747';
const evidencePath = path.resolve(here, '../../../.tmp/aidlc-control/aidlc-install.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
const evidence = [];
const ids = {};
async function request(route, method = 'GET', body) {
  const response = await fetch(api + route, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
const loops = (await request('/loops')).items;
for (const name of ['planning', 'implementation', 'review', 'pr-ci', 'qa', 'closing', 'parent']) {
  if (name === 'parent') {
    const idsPath = path.join(path.dirname(evidencePath), 'aidlc-loop-ids.json');
    fs.writeFileSync(idsPath, JSON.stringify(ids, null, 2));
    const compiled = spawnSync(process.execPath, [path.join(here, 'instantiate.mjs'), idsPath], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (compiled.status !== 0) throw new Error(compiled.stderr);
  }
  const exported = JSON.parse(fs.readFileSync(path.join(dir, `${name}.loop.json`), 'utf8'));
  const old = loops.filter((x) => x.name === exported.loop.name);
  if (old.length > 1) throw new Error('Duplicate named loop');
  let saved;
  if (old.length) {
    ids[name] = old[0].id;
    saved = await request(`/loops/${ids[name]}/draft`, 'PUT', { definition: exported.loop });
  } else {
    saved = await request('/loops/import', 'POST', exported);
    ids[name] = saved.loop.id;
  }
  const validation = await request(`/loops/${ids[name]}/validate`, 'POST', {
    definition: exported.loop,
  });
  const entry = { name, id: ids[name], importIssues: saved.issues, validation };
  evidence.push(entry);
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  if (!validation.publishable || validation.issues.some((x) => x.severity === 'error'))
    throw new Error(JSON.stringify(entry));
  entry.publication = await request(`/loops/${ids[name]}/publish`, 'POST', {});
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      name,
      id: ids[name],
      issues: validation.issues,
      version: entry.publication.version?.version,
    }),
  );
}
