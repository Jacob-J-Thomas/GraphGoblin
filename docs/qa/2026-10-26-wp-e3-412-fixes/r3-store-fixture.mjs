import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './r2-qa-lib.mjs';
const { LoopDefinitionSchema } = await import(pathToFileURL(join(root, 'packages/contracts/dist/index.js')).href);
const { minimalLoop, fakeUlid, samplePin, sampleThread, FIXTURE_TS } = await import(pathToFileURL(join(root, 'packages/contracts/dist/testing/index.js')).href);
export async function seedRetained(container, dataDir) {
  const marker = join(dataDir, 'r3-retained-fixture.json');
  try { return JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const paths = [], rawPaths = [], fixed = [];
  for (let i = 0; i < 75; i++) {
    const path = join(dataDir, 'retained', String(i));
    await mkdir(path, { recursive: true }); await writeFile(join(path, 'keep'), 'retained bytes', 'utf8');
    let raw = path;
    if (i % 10 === 0) { raw = join(dataDir, 'retained-alias-' + i); await symlink(path, raw, 'junction'); }
    paths.push(path); rawPaths.push(raw);
    const created = await container.repos.loops.create('local', LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'Retained fixed ' + i, settings: { workingDirectory: { kind: 'fixed', path: raw } } }));
    fixed.push(await container.repos.loops.publish(created.loop.id));
  }
  const loop = await container.repos.loops.create('local', LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'Retained template', settings: { workingDirectory: { kind: 'template', template: '{{vars.path}}' } } }));
  const template = await container.repos.loops.publish(loop.loop.id);
  const ids = [];
  for (let i = 0; i < 1000; i++) {
    const version = i % 2 ? template : fixed[i % 75]; const id = fakeUlid('native-r3-' + i);
    await container.repos.runs.create({ id, ownerId: 'local', loopId: version.loopId, versionId: version.id, invocationId: fakeUlid('native-inv-' + i), pinned: samplePin(), status: 'succeeded', iteration: 1, createdAt: FIXTURE_TS, lastEventSeq: 0 }, sampleThread());
    await container.repos.runs.markFinalized(id);
    await container.ports.workspace.resolve(version.definition.settings.workingDirectory, { vars: { path: rawPaths[i % 75] } }, id);
    ids.push(id);
  }
  const result = { runs: ids.length, paths, aliases: 8, lastId: ids.at(-1) };
  await writeFile(marker, JSON.stringify(result), 'utf8');
  return result;
}
export async function assertRetained(dataDir) {
  const info = JSON.parse(await readFile(join(dataDir, 'r3-retained-fixture.json'), 'utf8'));
  for (const path of info.paths) if (await readFile(join(path, 'keep'), 'utf8') !== 'retained bytes') throw new Error('Retained file changed');
  return { runs: info.runs, workspaces: info.paths.length, aliases: info.aliases, filesIntact: true, lastId: info.lastId };
}
