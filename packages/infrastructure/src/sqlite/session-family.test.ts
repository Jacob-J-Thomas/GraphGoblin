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

describe.each(['sqlite', 'memory'] as const)('%s completed-visit session identity', (backend) => {
  it('selects the exact run, node, attempt and harness without timestamp or status guesses', async () => {
    const handle = backend === 'sqlite' ? await openMemoryDatabase() : undefined;
    const repo: HarnessSessionRepository = handle
      ? new SqliteSessionRepository(handle.db)
      : new InMemorySessionRepository();
    try {
      const base = {
        runId: 'run',
        nodeId: 'worker',
        attempt: 1,
        harness: 'codex' as const,
        status: 'finished' as const,
        updatedAt: '2026-10-23T00:00:00.000Z',
      };
      await repo.upsert({ ...base, sessionId: 'latest-visit' });
      await repo.upsert({ ...base, attempt: 2, sessionId: 'old-retry' });
      await repo.upsert({ ...base, nodeId: 'reviewer', sessionId: 'reviewer' });
      await repo.upsert({ ...base, runId: 'other', sessionId: 'other-run' });
      expect((await repo.forNodeAttempt('run', 'worker', 1, 'codex'))?.sessionId).toBe(
        'latest-visit',
      );
      expect((await repo.forNodeAttempt('run', 'worker', 2, 'codex'))?.sessionId).toBe('old-retry');
      expect(await repo.forNodeAttempt('run', 'worker', 1, 'claude')).toBeUndefined();
      expect(await repo.forNodeAttempt('run', 'absent', 1, 'codex')).toBeUndefined();
      expect(await repo.forNodeAttempt('absent', 'worker', 1, 'codex')).toBeUndefined();
      expect(await repo.forNodeAttempt('run', 'worker', 3, 'codex')).toBeUndefined();
    } finally {
      handle?.close();
    }
  });
});
