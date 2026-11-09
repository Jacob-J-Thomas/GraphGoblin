import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { VoiceProbe } from '@graphgoblin/contracts';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteSettings } from './settings.js';
import { settings } from './schema.js';
let handle: DatabaseHandle;
let repo: SqliteSettings;
const clock = new FakeClock(Date.parse('2030-02-01T00:00:00.000Z'));
const probe = (route: 'local' | 'cloud'): VoiceProbe => ({
  route,
  configRevision: 1,
  checkedAt: clock.now().toISOString(),
  fingerprint: `${route}-fingerprint`,
  suitable: true,
  latencyMs: 10,
  freeMemoryBytes: 64 * 1024 ** 2,
  message: 'Sample passed',
});
beforeEach(async () => {
  handle = await openMemoryDatabase();
  repo = new SqliteSettings(handle.db, clock);
  await repo.compareVoiceConfig('local', 0, { revision: 1 });
});
afterEach(() => handle.close());
describe('atomic route qualification', () => {
  it('preserves concurrent local/cloud results and prevents an older same-route probe from clearing quarantine', async () => {
    const observed = await repo.getVoiceProbeState('local', 'local');
    expect(await repo.saveVoiceProbe('local', probe('local'), observed.generation)).toBe(true);
    const beforeFailure = await repo.getVoiceProbeState('local', 'local');
    await Promise.all([
      repo.saveVoiceProbe('local', probe('cloud'), 0),
      repo.quarantineVoiceProbe('local', 1, 'local-fingerprint', 'Retest required'),
    ]);
    expect((await repo.getVoiceProbeState('local', 'cloud')).probe?.suitable).toBe(true);
    expect(await repo.saveVoiceProbe('local', probe('local'), beforeFailure.generation)).toBe(
      false,
    );
    const quarantined = await repo.getVoiceProbeState('local', 'local');
    expect(quarantined).toMatchObject({
      generation: 1,
      probe: { suitable: false, message: 'Retest required' },
    });
    expect(await repo.saveVoiceProbe('local', probe('local'), quarantined.generation)).toBe(true);
    await repo.quarantineVoiceProbe('local', 1, 'different-fingerprint', 'must not quarantine');
    expect((await repo.getVoiceProbeState('local', 'local')).probe?.suitable).toBe(true);
    await repo.compareVoiceConfig('local', 1, { revision: 2 });
    expect(await repo.saveVoiceProbe('local', probe('local'), 1)).toBe(false);
  });
});
describe('bounded setup identities', () => {
  it('compacts old terminal results without dropping their dedupe identity or exposing internal settings', async () => {
    const id = randomUUID();
    await repo.set('local', `chat.voice.operation.${id}`, {
      hash: 'old-hash',
      result: {
        operationId: id,
        kind: 'probe',
        state: 'succeeded',
        probe: { transcript: 'old verbose sample' },
      },
    });
    await handle.db.update(settings).set({ updatedAt: '2029-01-01T00:00:00.000Z' });
    expect(
      await repo.beginVoiceOperation('local', randomUUID(), {
        hash: 'new',
        result: { state: 'running' },
      }),
    ).toBe(true);
    expect(await repo.get('local', `chat.voice.operation.${id}`)).toEqual({
      hash: 'old-hash',
      result: { operationId: id, kind: 'probe', state: 'failed', code: 'VOICE_OPERATION_RETIRED' },
    });
    expect(await repo.beginVoiceOperation('local', id, { hash: 'changed' })).toBe(false);
    await repo.set('local', 'ordinary', { enabled: true });
    expect(await repo.getAll('local')).toEqual({ ordinary: { enabled: true } });
  });
  it('refuses new IDs at the owner cap while allowing duplicates and other owners', async () => {
    const values = Array.from({ length: 8192 }, (_, i) => ({
      ownerId: 'local',
      key: `chat.voice.operation.${i}`,
      value: '{}',
      updatedAt: clock.now().toISOString(),
    }));
    for (let i = 0; i < values.length; i += 400)
      await handle.db.insert(settings).values(values.slice(i, i + 400));
    expect(await repo.beginVoiceOperation('local', randomUUID(), {})).toBe('capacity');
    expect(await repo.beginVoiceOperation('local', '0', {})).toBe(false);
    expect(await repo.beginVoiceOperation('other', randomUUID(), {})).toBe(true);
  });
});
