import { describe, expect, it } from 'vitest';
import type { HarnessSessionRepository } from '@graphgoblin/engine';
import { InMemorySessionRepository } from '@graphgoblin/engine/testing';
import { openMemoryDatabase } from './db.js';
import { SqliteSessionRepository } from './sessions.js';
describe.each(['sqlite', 'memory'] as const)('%s session family selection', (backend) => {
  it('filters before sorting, preserving older same-family rows and existing keys', async () => {
    const handle = backend === 'sqlite' ? await openMemoryDatabase() : undefined;
    const repo: HarnessSessionRepository = handle
      ? new SqliteSessionRepository(handle.db)
      : new InMemorySessionRepository();
    try {
      const base = {
        runId: 'run',
        attempt: 1,
        scopeKey: 'loop:shared',
        status: 'finished' as const,
      };
      for (const [nodeId, harness, sessionId, time] of [
        ['c-old', 'codex', 'codex-old', '01'],
        ['a-old', 'claude', 'claude-old', '02'],
        ['c-new', 'codex', 'codex-new', '03'],
        ['a-empty', 'claude', undefined, '04'],
      ] as const)
        await repo.upsert({
          ...base,
          nodeId,
          harness,
          ...(sessionId ? { sessionId } : {}),
          updatedAt: '2026-10-07T12:00:' + time + '.000Z',
        });
      for (const [harness, expected] of [
        ['codex', 'codex-new'],
        ['claude', 'claude-old'],
      ] as const) {
        expect((await repo.latestWithSession('run', harness))?.sessionId).toBe(expected);
        expect((await repo.byScopeKey('loop:shared', harness))?.sessionId).toBe(expected);
        expect(await repo.latestWithSession('other', harness)).toBeUndefined();
        expect(await repo.byScopeKey('other', harness)).toBeUndefined();
      }
      await repo.upsert({
        ...base,
        nodeId: 'a-new',
        harness: 'claude',
        sessionId: 'claude-new',
        updatedAt: '2026-10-07T12:00:05.000Z',
      });
      expect((await repo.latestWithSession('run', 'codex'))?.sessionId).toBe('codex-new');
      expect((await repo.byScopeKey('loop:shared', 'claude'))?.sessionId).toBe('claude-new');
      expect((await repo.forNode('run', 'c-new'))?.harness).toBe('codex');
    } finally {
      handle?.close();
    }
  });
});
