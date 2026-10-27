import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, lstat, symlink, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { boot, inferenceLoop, contractTesting, testing } from './audit-api.mjs';
const mode = process.argv[2];
const root = mode === 'alias' ? await mkdtemp(fileURLToPath(new URL('gg-audit-e3-alias-', import.meta.url))) : undefined;
const api = await boot({ directory: root });
try {
  const loop = await api.create(inferenceLoop('Owned producer'));
  const owner = await api.run(loop);
  const thread = (await api.request(`/runs/${owner.id}/thread`)).value;
  const ref = thread.artifacts[0].ref;
  if (mode === 'case') {
    const alias = ref.toUpperCase();
    const before = await api.container.ports.artifacts.get(alias);
    assert.equal(typeof before, 'string');
    const retainedLoop = await api.create({ ...contractTesting.minimalLoop(), name: 'Retained input' });
    const retained = await api.run(retainedLoop, { input: { ref: alias } });
    const retainedThread = (await api.request(`/runs/${retained.id}/thread`)).value;
    assert.ok(JSON.stringify(retainedThread).includes(alias));
    await api.mark([owner.id]);
    const status = await api.poll();
    const after = await api.container.ports.artifacts.get(alias);
    console.log(JSON.stringify({ scenario: 'case-insensitive artifact reference', beforeReadable: typeof before === 'string', afterReadable: typeof after === 'string', retainedStatus: (await api.request(`/runs/${retained.id}`)).status, status }));
  } else if (mode === 'alias') {
    const original = api.harness.started[0].workingDirectory;
    await writeFile(join(original, 'retain.txt'), 'retained input bytes', 'utf8');
    const alias = join(api.directory, 'configured-junction');
    assert.ok(original.startsWith(fileURLToPath(new URL('../../../', import.meta.url))));
    await symlink(original, alias, 'junction');
    assert.equal((await realpath(alias)).toLowerCase(), original.toLowerCase());
    const definition = testing.singleNodeLoop('Retained waiting work', { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'duration', seconds: 3600 } });
    definition.settings = { workingDirectory: { kind: 'fixed', path: alias } };
    const retainedLoop = await api.create(definition);
    const retained = await api.run(retainedLoop);
    assert.equal(retained.status, 'waiting');
    await api.mark([owner.id]);
    const status = await api.poll();
    const present = await lstat(original).then(() => true, () => false);
    console.log(JSON.stringify({ scenario: 'retained fixed path through junction', retainedStatus: (await api.request(`/runs/${retained.id}`)).value.status, originalExists: present, status }));
  }
} finally { await api.close(); }


