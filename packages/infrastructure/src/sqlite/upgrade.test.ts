import { afterEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { validateLoop, type UpgradeCurrentResolutions } from '@graphgoblin/domain';
import type { Client } from '@libsql/client';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import {
  applyDatabaseUpgrade,
  guardDatabaseUpgrade,
  inspectDatabaseUpgrade,
  verifyDatabaseHead,
  RUN_HISTORY_TABLES,
} from './upgrade.js';
import { fixtureId, frozenDefinition, seedFormatThreeStore } from './testing/format-three-store.js';
import { tableNames, rows } from './upgrade-scan.js';
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
async function fixture() {
  const handle = openDatabase({ url: ':memory:' });
  handles.push(handle);
  await seedFormatThreeStore(handle);
  return handle;
}
const safety = {
  verifySafety: async () => {
    /* Unit tests have independent in-memory stores. Real lock/backup covered by CLI acceptance. */
  },
};
async function snapshot(client: Client) {
  return {
    schema: (await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows,
    rows: await Promise.all(
      (await tableNames(client)).map(async (name) => [
        name,
        await rows(client, 'SELECT * FROM "' + name + '" ORDER BY rowid'),
      ]),
    ),
  };
}
function approvals(
  plan: Awaited<ReturnType<typeof inspectDatabaseUpgrade>>,
): Record<string, UpgradeCurrentResolutions> {
  return Object.fromEntries(
    plan.definitions
      .filter((entry) => entry.conversion === 'pending')
      .map((entry) => [
        entry.id,
        {
          v3: Object.fromEntries(
            entry.reviewItems
              .filter((item) => item.status === 'pending')
              .map((item) => [
                item.id,
                {
                  hash: item.hash,
                  action: 'approve' as const,
                  reason: 'Reviewed fixture proposal',
                },
              ]),
          ),
        },
      ]),
  );
}
async function request(
  handle: DatabaseHandle,
  resolutions?: Record<string, UpgradeCurrentResolutions>,
) {
  resolutions ??= approvals(await inspectDatabaseUpgrade(handle.client));
  return {
    planHash: (await inspectDatabaseUpgrade(handle.client, resolutions)).planHash,
    resolutions,
  };
}
async function refuses(
  handle: DatabaseHandle,
  selected: Awaited<ReturnType<typeof request>>,
  message: RegExp,
) {
  const before = await snapshot(handle.client);
  await expect(applyDatabaseUpgrade(handle.client, selected, safety)).rejects.toThrow(message);
  expect(await snapshot(handle.client)).toEqual(before);
}
describe('definitions-only format-4 cutover', () => {
  it('inspects every published version and draft without writes, excludes active template work, and reports disarms/counts', async () => {
    const handle = await fixture(),
      before = await snapshot(handle.client);
    const plan = await inspectDatabaseUpgrade(handle.client);
    expect(plan.issues).toEqual([]);
    expect(plan.counts).toEqual({
      loops: 9,
      versions: 8,
      drafts: 8,
      templateInstances: 1,
      templateLoops: 1,
      runs: 9,
      events: 9,
      receipts: 9,
    });
    expect(plan.definitions).toHaveLength(16);
    expect(
      plan.definitions.find((entry) => entry.id === fixtureId('manual-version'))?.loopName,
    ).toBe('manual');
    expect(plan.definitions.filter((entry) => entry.conversion === 'pending')).toHaveLength(4);
    expect(plan.definitions.filter((entry) => entry.conversion === 'invalid')).toEqual([]);
    expect(plan.blockedRuns).toEqual([]);
    expect(plan.blockedReceipts).toEqual([]);
    expect(plan.disarm).toHaveLength(5);
    expect(plan.disarm.filter((entry) => entry.type === 'poll')).toHaveLength(2);
    expect(plan.disarm.find((entry) => entry.scheduleId)?.scheduleId).toBe('cron-schedule');
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await inspectDatabaseUpgrade(handle.client)).planHash).toBe(plan.planHash);
    expect(await snapshot(handle.client)).toEqual(before);
    await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  });
  it('deletes all history and configured templates, converts definitions, retains signing identities/secrets/settings, and starts through ordinary migrations', async () => {
    const handle = await fixture();
    const retained = await Promise.all(
      ['secrets', 'settings', 'api_keys'].map((name) =>
        rows(handle.client, 'SELECT * FROM ' + name),
      ),
    );
    const beforeDraft = (
      await rows(handle.client, 'SELECT definition FROM loop_versions WHERE id=?', [
        fixtureId('poll-draft'),
      ])
    )[0]?.definition;
    const result = await applyDatabaseUpgrade(handle.client, await request(handle), safety);
    expect(result).toMatchObject({ status: 'upgraded', definitions: 16, deletedRuns: 9 });
    for (const table of RUN_HISTORY_TABLES)
      expect(await rows(handle.client, 'SELECT * FROM ' + table)).toEqual([]);
    expect(await tableNames(handle.client)).not.toContain('template_instances');
    expect(await tableNames(handle.client)).not.toContain('gg_upgrade_archive');
    expect(
      await rows(handle.client, 'SELECT * FROM loops WHERE id=?', [fixtureId('template')]),
    ).toEqual([]);
    expect(
      await rows(handle.client, 'SELECT * FROM loop_versions WHERE loop_id=?', [
        fixtureId('template'),
      ]),
    ).toEqual([]);
    for (const row of await rows(handle.client, 'SELECT * FROM loop_versions')) {
      const definition = LoopDefinitionSchema.parse(JSON.parse(String(row.definition)));
      expect(validateLoop(definition).filter((entry) => entry.severity === 'error')).toEqual([]);
      for (const node of definition.nodes)
        if (node.kind === 'trigger' && (node.config.type === 'cron' || node.config.type === 'poll'))
          expect(node.config.enabled).toBe(false);
    }
    expect(
      (
        await rows(handle.client, 'SELECT definition FROM loop_versions WHERE id=?', [
          fixtureId('poll-draft'),
        ])
      )[0]?.definition,
    ).not.toBe(beforeDraft);
    expect(await rows(handle.client, 'SELECT enabled FROM schedules')).toEqual([{ enabled: 0 }]);
    expect(
      await rows(
        handle.client,
        'SELECT id,token,auth_type,signature_message,signature_header,secret_ref,window_seconds,enabled FROM webhook_endpoints ORDER BY id',
      ),
    ).toEqual([
      {
        id: 'body-endpoint',
        token: 'body-token',
        auth_type: 'hmac-sha256',
        signature_message: 'body',
        signature_header: 'x-signature',
        secret_ref: 'hook-secret',
        window_seconds: null,
        enabled: 1,
      },
      {
        id: 'timestamp-endpoint',
        token: 'timestamp-token',
        auth_type: 'hmac-sha256',
        signature_message: 'timestamp-body',
        signature_header: 'x-signature',
        secret_ref: 'hook-secret',
        window_seconds: 300,
        enabled: 1,
      },
    ]);
    expect(
      await Promise.all(
        ['secrets', 'settings', 'api_keys'].map((name) =>
          rows(handle.client, 'SELECT * FROM ' + name),
        ),
      ),
    ).toEqual(retained);
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    await verifyDatabaseHead(handle.client);
    await handle.migrate();
    expect(await handle.pendingMigrations()).toBe(0);
    const before = await snapshot(handle.client);
    expect(await applyDatabaseUpgrade(handle.client, await request(handle), safety)).toMatchObject({
      status: 'current',
      deletedRuns: 0,
      definitions: 0,
    });
    expect(await snapshot(handle.client)).toEqual(before);
  });
  it.each(['queued', 'running', 'waiting', 'paused'])(
    'blocks ordinary %s runs without cancelling them',
    async (status) => {
      const handle = await fixture();
      await handle.client.execute({
        sql: 'UPDATE runs SET status=? WHERE id=?',
        args: [status, fixtureId('manual-run')],
      });
      const plan = await inspectDatabaseUpgrade(handle.client);
      expect(plan.blockedRuns).toEqual([
        { id: fixtureId('manual-run'), loopId: fixtureId('manual'), status },
      ]);
      await refuses(handle, await request(handle), /nonterminal/);
    },
  );
  it('blocks a pending ordinary receipt and its frozen admission intent', async () => {
    const handle = await fixture();
    await handle.client.execute(
      "UPDATE webhook_receipts SET status='pending' WHERE id='body-receipt'",
    );
    expect((await inspectDatabaseUpgrade(handle.client)).blockedReceipts).toMatchObject([
      { id: 'body-receipt', reason: expect.stringContaining('intent') },
    ]);
    await refuses(handle, await request(handle), /admission intents/);
  });
  it('requires every hash-bound review, binds repeated nodes to their stored version, and rejects stale/unused resolutions', async () => {
    const handle = await fixture();
    const definition = frozenDefinition('llm', {
      answer: {
        type: 'choice',
        options: [
          { id: 'yes', label: 'Yes', criteria: 'Ready' },
          { id: 'no', label: 'No', criteria: 'Needs work' },
        ],
      },
      evaluation: {
        kind: 'llm',
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        question: 'Ready?',
      },
    });
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition=? WHERE loop_id=?',
      args: [JSON.stringify(definition), fixtureId('manual')],
    });
    const plan = await inspectDatabaseUpgrade(handle.client);
    const pending = plan.definitions.filter((entry) => entry.conversion === 'pending');
    expect(pending).toHaveLength(6);
    expect(
      pending[0]?.reviewItems.some(
        (entry) => entry.status === 'pending' && entry.id && entry.hash && entry.reason,
      ),
    ).toBe(true);
    expect(pending[0]?.reviewItems.map((entry) => entry.hash)).not.toEqual(
      pending[1]?.reviewItems.map((entry) => entry.hash),
    );
    await refuses(handle, await request(handle, {}), /Unresolved/);
    const resolutions = Object.fromEntries(
      pending.map((entry) => [
        entry.id,
        {
          v3: Object.fromEntries(
            entry.reviewItems
              .filter((item) => item.status === 'pending')
              .map((item) => [
                item.id,
                {
                  hash: item.hash,
                  action: 'approve' as const,
                  reason: 'Reviewed exact fixture proposal',
                },
              ]),
          ),
        },
      ]),
    );
    const resolved = await inspectDatabaseUpgrade(handle.client, resolutions);
    expect(resolved.definitions.every((entry) => entry.conversion === 'automatic')).toBe(true);
    expect(resolved.planHash).not.toBe(plan.planHash);
    await refuses(handle, { planHash: plan.planHash, resolutions }, /hash changed/);
    const stale = structuredClone(resolutions);
    const first = Object.values(stale)[0]!;
    Object.values(first.v3)[0]!.hash = '0'.repeat(64);
    await refuses(handle, await request(handle, stale), /Unresolved/);
    await refuses(handle, await request(handle, { unknown: {} }), /Unresolved/);
    await refuses(
      handle,
      await request(handle, {
        [fixtureId('cron-version')]: { v1: { sources: { '/unused': 'true' } } },
      }),
      /Unresolved/,
    );
    await applyDatabaseUpgrade(handle.client, { planHash: resolved.planHash, resolutions }, safety);
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
  });
  it('refuses changed source, damaged SQL/ledger, malformed template identities and invalid definitions', async () => {
    const handle = await fixture();
    const selected = await request(handle);
    await handle.client.execute("UPDATE settings SET value='{}'");
    await refuses(handle, selected, /hash changed/);
    for (const sql of [
      "UPDATE loop_versions SET definition='{'",
      "UPDATE template_instances SET instance='{}'",
      'DROP INDEX runs_parent_idx',
      "UPDATE __drizzle_migrations SET hash='changed'",
    ]) {
      const damaged = await fixture();
      await damaged.client.execute(sql);
      const plan = await inspectDatabaseUpgrade(damaged.client);
      expect(
        plan.issues.length +
          plan.definitions.filter((entry) => entry.conversion === 'invalid').length,
      ).toBeGreaterThan(0);
      await refuses(damaged, await request(damaged), /Unresolved|nonterminal/);
    }
  });
  it('rolls back deletions, DDL, ledger, rewrites and marker on a failure after structural SQL', async () => {
    const handle = await fixture(),
      before = await snapshot(handle.client),
      selected = await request(handle);
    const client = new Proxy(handle.client, {
      get(target, key) {
        if (key === 'transaction')
          return async () => {
            const tx = await target.transaction('write'),
              execute = tx.execute.bind(tx);
            tx.execute = (statement) => {
              const sql = typeof statement === 'string' ? statement : statement.sql;
              if (sql.startsWith('UPDATE schedules SET enabled'))
                throw new Error('injected after DDL and definition rewrites');
              return execute(statement);
            };
            return tx;
          };
        const value: unknown = Reflect.get(target, key);
        return value;
      },
    });
    await expect(applyDatabaseUpgrade(client, selected, safety)).rejects.toThrow('injected');
    expect(await snapshot(handle.client)).toEqual(before);
    await applyDatabaseUpgrade(handle.client, selected, safety);
  });
  it('rechecks safety at commit and rolls back if the lock or backup is lost', async () => {
    const handle = await fixture(),
      selected = await request(handle),
      before = await snapshot(handle.client);
    let checks = 0;
    await expect(
      applyDatabaseUpgrade(handle.client, selected, {
        verifySafety: () => {
          checks += 1;
          return checks === 1
            ? Promise.resolve()
            : Promise.reject(new Error('lock or backup lost'));
        },
      }),
    ).rejects.toThrow('lock or backup lost');
    expect(checks).toBe(2);
    expect(await snapshot(handle.client)).toEqual(before);
  });
  it('refuses an ordinary definition that would invoke a retired template loop', async () => {
    const handle = await fixture();
    const original = frozenDefinition();
    const definition = {
      ...original,
      nodes: [
        original.nodes[0],
        {
          id: 'child',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: fixtureId('template'), version: 'latest' } },
        },
        original.nodes[1],
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'child' } },
        { id: 'b', from: { node: 'child', port: 'out' }, to: { node: 'done' } },
      ],
    };
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
      args: [JSON.stringify(definition), fixtureId('manual-version')],
    });
    const plan = await inspectDatabaseUpgrade(handle.client);
    expect(
      plan.definitions.find((entry) => entry.id === fixtureId('manual-version'))?.issues,
    ).toMatchObject([{ kind: 'invalid', message: expect.stringContaining('retired template') }]);
    await refuses(handle, await request(handle), /Unresolved/);
  });
  it('requires the stopped lock/backup capability and propagates failed safety verification before transaction', async () => {
    const handle = await fixture(),
      selected = await request(handle),
      before = await snapshot(handle.client);
    await expect(applyDatabaseUpgrade(handle.client, selected)).rejects.toThrow(/lock.*backup/);
    await expect(
      applyDatabaseUpgrade(handle.client, selected, {
        verifySafety: () => Promise.reject(new Error('invalid backup')),
      }),
    ).rejects.toThrow('invalid backup');
    expect(await snapshot(handle.client)).toEqual(before);
  });
  it('removes old database archives and converts legacy owner defaults without changing other settings', async () => {
    const handle = await fixture();
    await handle.client.execute('CREATE TABLE gg_upgrade_archive (payload TEXT)');
    await handle.client.execute(
      "INSERT INTO gg_upgrade_archive VALUES ('historical private data')",
    );
    await handle.client.execute("DELETE FROM settings WHERE key='defaults'");
    await handle.client.execute(
      "INSERT INTO settings VALUES ('local','defaultModel','\"gpt-6-luna\"','2026-10-17T00:00:00.000Z')",
    );
    await handle.client.execute(
      "INSERT INTO settings VALUES ('local','defaultEffort','\"low\"','2026-10-17T00:00:00.000Z')",
    );
    await applyDatabaseUpgrade(handle.client, await request(handle), safety);
    expect(await tableNames(handle.client)).not.toContain('gg_upgrade_archive');
    expect(await rows(handle.client, 'SELECT key,value FROM settings')).toEqual([
      { key: 'defaults', value: '{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}' },
    ]);
  });
  it.each([
    "UPDATE settings SET value='not JSON'",
    "INSERT INTO settings VALUES ('local','defaultModel','\"unknown\"','2026-10-17T00:00:00.000Z')",
    "INSERT INTO settings VALUES ('other','defaultEffort','\"invalid\"','2026-10-17T00:00:00.000Z')",
  ])('refuses invalid/conflicting owner defaults: %s', async (sql) => {
    const handle = await fixture();
    await handle.client.execute(sql);
    expect((await inspectDatabaseUpgrade(handle.client)).issues.length).toBeGreaterThan(0);
    await refuses(handle, await request(handle), /Unresolved/);
  });
  it.each([
    "UPDATE gg_upgrade_state SET status='pending'",
    'DELETE FROM gg_upgrade_state',
    'DROP INDEX runs_parent_idx',
    'CREATE TABLE template_instances (id TEXT)',
    'ALTER TABLE runs ADD COLUMN template_subject TEXT',
    // The required format baseline must remain present even when optional SQL follows it.
    'DELETE FROM __drizzle_migrations WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)',
    'UPDATE gg_upgrade_state SET format_version=3',
  ])('refuses damaged or old completion state before ordinary startup writes: %s', async (sql) => {
    const handle = await openMemoryDatabase();
    handles.push(handle);
    await handle.client.execute(sql);
    const before = await snapshot(handle.client);
    await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect(await snapshot(handle.client)).toEqual(before);
  });
  it('refuses a recorded ledger without application tables and permits a truly empty ledger', async () => {
    const handle = openDatabase({ url: ':memory:' });
    handles.push(handle);
    await handle.client.execute(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY,hash TEXT,created_at NUMERIC)',
    );
    expect(await guardDatabaseUpgrade(handle.client)).toBe('fresh');
    await handle.client.execute("INSERT INTO __drizzle_migrations VALUES(1,'old',1)");
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
  });
  it('treats a genuinely fresh format-4 store as a no-op', async () => {
    const handle = await openMemoryDatabase();
    handles.push(handle);
    expect((await inspectDatabaseUpgrade(handle.client)).status).toBe('current');
    await handle.client.execute({
      sql: 'INSERT INTO loop_versions VALUES (?,?,1,?,?,?,NULL)',
      args: [
        fixtureId('fresh-version'),
        fixtureId('fresh-loop'),
        'draft',
        JSON.stringify(minimalLoop()),
        '2026-10-17T00:00:00.000Z',
      ],
    });
    const before = await snapshot(handle.client);
    await applyDatabaseUpgrade(handle.client, await request(handle), safety);
    expect(await snapshot(handle.client)).toEqual(before);
  });
});
