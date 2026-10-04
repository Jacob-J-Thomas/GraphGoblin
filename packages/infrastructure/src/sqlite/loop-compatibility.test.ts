import { describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS, legacyHarnessLoop } from '@graphgoblin/contracts/testing';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase } from './db.js';
import { SqliteLoopRepository } from './loops.js';

describe('legacy version read normalisation', () => {
  it('normalises every repository read without changing stored JSON or version metadata', async () => {
    const handle = await openMemoryDatabase();
    try {
      const loopId = fakeUlid('old-loop');
      const versionId = fakeUlid('old-version');
      const raw = JSON.stringify(legacyHarnessLoop());
      await handle.client.batch(
        [
          {
            sql: 'INSERT INTO loops (id, owner_id, name, draft_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [loopId, 'local', 'old', versionId, FIXTURE_TS, FIXTURE_TS],
          },
          {
            sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at) VALUES (?, ?, 7, ?, ?, ?)',
            args: [versionId, loopId, 'draft', raw, FIXTURE_TS],
          },
        ],
        'write',
      );
      const repo = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
      const draft = await repo.getVersion(versionId);
      expect(draft?.definition.settings.defaults).not.toHaveProperty('harness');
      const published = await repo.publish(loopId);
      expect(published).toMatchObject({
        id: versionId,
        version: 7,
        createdAt: FIXTURE_TS,
        status: 'published',
      });
      for (const version of [
        await repo.getVersion(versionId),
        await repo.getLatestPublished(loopId),
        await repo.getPublished(loopId, 7),
        ...(await repo.listVersions(loopId)),
      ]) {
        expect(version).toEqual(published);
        expect(version?.definition.nodes[1]).toMatchObject({ config: { harness: 'codex' } });
      }
      const before = await handle.client.execute({
        sql: 'SELECT * FROM loop_versions WHERE id = ?',
        args: [versionId],
      });
      await repo.listVersions(loopId);
      await repo.getVersion(versionId);
      expect(
        await handle.client.execute({
          sql: 'SELECT * FROM loop_versions WHERE id = ?',
          args: [versionId],
        }),
      ).toEqual(before);
      expect(before.rows[0]?.['definition']).toBe(raw);
      expect(before.rows[0]?.['published_at']).toBe(published?.publishedAt);
    } finally {
      handle.close();
    }
  });
});
