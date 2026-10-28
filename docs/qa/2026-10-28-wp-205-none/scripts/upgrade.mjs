// WP-205 upgrade check, in two phases on the same disposable stores. No runs are started, so no
// turn reaches any CLI; the gateways run the machine's CLIs for their no-turn preflight only.
//
//   node upgrade.mjs a   with this worktree built at the base a4fee9a9 (before any WP-205 change)
//   node upgrade.mjs b   with this worktree built at the WP-205 head
//   node upgrade.mjs rearm   writes U2's minimal values again after a phase-b run fixed them
//   node upgrade.mjs snap    a draft snapshot that names minimal, and its hand fix (after b)
//
// Store U1 is written only through the base build's public API: catalog state (one model
// disabled), owner defaults, three published loops and one draft at efforts the base offered.
// Store U2 holds a stored `minimal` of the kind a build before PR #426 could write (a published
// version, a draft, an owner default and a hand-added catalog row). The base refuses `minimal`
// for every seeded model, so those values are written into U2's rows with SQL after the base
// build created them through its API, as the F2 record's D2 step did. Phase b reopens both stores
// with the new build, records what a stored `minimal` does, applies the hand fix the CHANGELOG
// gives, and reopens U2 once more.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const phase = process.argv[2];
if (!['a', 'rearm', 'b', 'snap'].includes(phase))
  throw new Error('usage: node upgrade.mjs a|rearm|b|snap');
const STATE = path.join(os.tmpdir(), 'gg-205-upgrade-state.json');
const rec = new L.Recorder(`upgrade-${phase}`);
const gateways = [];
const GPT6 = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra'];
const GPT56 = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'];
const CLAUDE = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const NONE_TO_MAX = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const LOW_TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'];
const LOW_TO_XHIGH = ['low', 'medium', 'high', 'xhigh'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function catalog(g) {
  const items = (await g.call('/model-catalog')).json.items;
  return Object.fromEntries(
    items.map((i) => [
      `${i.harness}/${i.model}`,
      { efforts: i.efforts, defaultEffort: i.defaultEffort, enabled: i.enabled, source: i.source },
    ]),
  );
}

async function storedRows(dir) {
  return L.withDb(dir, async (db) => {
    const catalogRows = await db.execute(
      'select harness, model, source, efforts, default_effort, enabled from model_catalog order by harness, model',
    );
    const settings = await db.execute('select key, value from settings order by key');
    const versions = await db.execute(
      'select v.id, l.name, v.status, v.definition from loop_versions v join loops l on l.id = v.loop_id order by l.name, v.version',
    );
    return {
      catalog: catalogRows.rows.map((r) => ({ ...r })),
      settings: settings.rows.map((r) => ({ ...r })),
      versions: versions.rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        efforts: [...String(r.definition).matchAll(/"effort":("[a-z]+"|\{[^}]*\})/g)].map(
          (m) => m[1],
        ),
      })),
    };
  });
}

/** The hand fix the CHANGELOG upgrade note gives, one statement per stored place. */
export const HAND_FIX = [
  `UPDATE loop_versions SET definition = replace(replace(definition, '"effort":"minimal"', '"effort":"none"'), '"effort":{"mode":"explicit","value":"minimal"}', '"effort":{"mode":"explicit","value":"none"}') WHERE status <> 'snapshot' AND definition LIKE '%"minimal"%'`,
  `UPDATE settings SET value = replace(value, '"effort":"minimal"', '"effort":"none"') WHERE value LIKE '%"effort":"minimal"%'`,
  `UPDATE model_catalog SET efforts = replace(efforts, '"minimal"', '"none"'), default_effort = replace(default_effort, 'minimal', 'none') WHERE efforts LIKE '%"minimal"%' OR default_effort = 'minimal'`,
];

/** Run records can name an effort in their pinned defaults (one statement, as above). */
export const RUN_FIX = `UPDATE runs SET pinned = replace(pinned, '"effort":"minimal"', '"effort":"none"') WHERE pinned LIKE '%"effort":"minimal"%'`;

/** The snapshot trigger exactly as migration 0019 restores it. */
const SNAPSHOT_TRIGGER =
  "CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";

/** Draft snapshots are immutable by trigger: lift it, fix, restore it, in one transaction. */
export const SNAPSHOT_FIX = [
  'DROP TRIGGER loop_versions_snapshot_immutable',
  `UPDATE loop_versions SET definition = replace(replace(definition, '"effort":"minimal"', '"effort":"none"'), '"effort":{"mode":"explicit","value":"minimal"}', '"effort":{"mode":"explicit","value":"none"}') WHERE status = 'snapshot' AND definition LIKE '%"minimal"%'`,
  SNAPSHOT_TRIGGER,
];

try {
  if (phase === 'a') {
    if (fs.existsSync(STATE)) throw new Error(`refusing to overwrite ${STATE}`);
    const u1 = L.makeStore('upgrade-u1');
    const u2 = L.makeStore('upgrade-u2');
    const ids = {};

    // ---------------- U1: the base build's public API only ----------------
    const g1 = await L.startGateway({ dir: u1, port: 6300, label: 'u1-base', rec });
    gateways.push(g1);
    const base = await catalog(g1);
    rec.log('base GET /model-catalog', base);
    rec.check(
      'A-1 the base offers low to max for GPT-6 and GPT-5.6, low to xhigh for GPT-5.5, low to max for Claude; no none',
      [...GPT6, ...GPT56].every((m) => same(base[`codex/${m}`]?.efforts, LOW_TO_MAX)) &&
        same(base['codex/gpt-5.5']?.efforts, LOW_TO_XHIGH) &&
        CLAUDE.every((m) => same(base[`claude/${m}`]?.efforts, LOW_TO_MAX)),
      Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.efforts])),
    );
    const disable = await g1.call('/model-catalog/codex/gpt-6-astra', {
      method: 'PATCH',
      body: { enabled: false },
    });
    const put = await g1.call('/settings', {
      method: 'PUT',
      body: {
        defaults: {
          byHarness: {
            codex: { model: 'gpt-6-luna', effort: 'low' },
            claude: { model: 'claude-sonnet-5-5', effort: 'high' },
          },
        },
      },
    });
    ids.P1 = await L.publishLoop(
      g1.call,
      L.single(
        'U1 P1 inference luna max',
        L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'max' }),
      ),
    );
    ids.P2 = await L.publishLoop(
      g1.call,
      L.single(
        'U1 P2 decision gpt-5.5 xhigh',
        L.llmDecisionNode('work', { model: 'gpt-5.5', effort: 'xhigh' }),
      ),
    );
    ids.P3 = await L.publishLoop(
      g1.call,
      L.single('U1 P3 loop default 5.6 low', L.inferenceNode('work', {}), {
        defaults: { byHarness: { codex: { model: 'gpt-5.6-luna', effort: 'low' } } },
      }),
    );
    const d1 = await L.createLoop(
      g1.call,
      L.single(
        'U1 D1 draft claude medium',
        L.inferenceNode('work', { harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' }),
      ),
    );
    ids.D1 = d1.json?.loop?.id;
    rec.check(
      'A-2 the base disables gpt-6-astra, saves owner defaults, publishes P1-P3 and saves draft D1',
      disable.status === 200 && put.status === 200 && ids.P1 && ids.P2 && ids.P3 && d1.status === 201,
      { disable: disable.status, put: L.problemOf(put), d1: d1.status, ids },
    );
    const none = await L.createLoop(
      g1.call,
      L.single(
        'U1 none refused by base',
        L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'none' }),
      ),
    );
    rec.check(
      'A-3 the base refuses effort none (not on its scale)',
      none.status === 400,
      L.problemOf(none),
    );
    rec.check('A-4 U1 base gateway drains to exit 0', (await g1.stop()) === 0, g1.exitCode());
    g1.copyLog('upgrade-a-u1-gateway.log.txt');

    // ---------------- U2: rows that will hold a stored minimal ----------------
    const g2 = await L.startGateway({ dir: u2, port: 6301, label: 'u2-base', rec });
    gateways.push(g2);
    ids.M1 = await L.publishLoop(
      g2.call,
      L.single(
        'U2 M1 inference luna',
        L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'low' }),
      ),
    );
    const m2 = await L.createLoop(
      g2.call,
      L.single(
        'U2 M2 draft decision luna',
        L.llmDecisionNode('work', { model: 'gpt-6-luna', effort: 'low' }),
      ),
    );
    ids.M2 = m2.json?.loop?.id;
    const put2 = await g2.call('/settings', {
      method: 'PUT',
      body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } } },
    });
    rec.check(
      'A-5 the base publishes M1, saves draft M2 and an owner default on U2',
      ids.M1 && m2.status === 201 && put2.status === 200,
      { m2: m2.status, put2: put2.status, ids },
    );
    rec.check('A-6 U2 base gateway drains to exit 0', (await g2.stop()) === 0, g2.exitCode());
    g2.copyLog('upgrade-a-u2-gateway.log.txt');
    await L.withDb(u2, async (db) => {
      await db.execute(
        `UPDATE loop_versions SET definition = replace(replace(definition, '"effort":"low"', '"effort":"minimal"'), '"effort":{"mode":"explicit","value":"low"}', '"effort":{"mode":"explicit","value":"minimal"}') WHERE loop_id IN ('${ids.M1}', '${ids.M2}')`,
      );
      await db.execute(
        `UPDATE settings SET value = replace(value, '"effort":"low"', '"effort":"minimal"') WHERE key = 'defaults'`,
      );
      await db.execute(
        `INSERT INTO model_catalog (harness, model, source, display_name, efforts, default_effort, enabled) VALUES ('codex', 'gpt-5-handadded', 'harness', 'GPT-5 hand-added', '["minimal","low","medium","high"]', 'minimal', 1)`,
      );
    });
    rec.log('U2 stored rows after writing minimal', await storedRows(u2));
    fs.writeFileSync(STATE, JSON.stringify({ u1, u2, ids }, null, 2));
    rec.log('state saved', { state: STATE });
  } else if (phase === 'rearm') {
    // The same stored values phase a wrote, written again over the values a phase-b run fixed.
    const { u2, ids } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const changed = await L.withDb(u2, async (db) => [
      (
        await db.execute(
          `UPDATE loop_versions SET definition = replace(replace(definition, '"effort":"none"', '"effort":"minimal"'), '"effort":{"mode":"explicit","value":"none"}', '"effort":{"mode":"explicit","value":"minimal"}') WHERE loop_id IN ('${ids.M1}', '${ids.M2}')`,
        )
      ).rowsAffected,
      (
        await db.execute(
          `UPDATE settings SET value = replace(value, '"effort":"none"', '"effort":"minimal"') WHERE key = 'defaults'`,
        )
      ).rowsAffected,
      (
        await db.execute(
          `UPDATE model_catalog SET efforts = '["minimal","low","medium","high"]', default_effort = 'minimal' WHERE model = 'gpt-5-handadded'`,
        )
      ).rowsAffected,
    ]);
    rec.log('U2 minimal written again (rows per statement)', changed);
    rec.log('U2 stored rows after re-arming', await storedRows(u2));
  } else if (phase === 'snap') {
    // A draft snapshot (status `snapshot`, pinned by a draft run) that names minimal. Snapshots are
    // immutable by trigger, so both writing the old value and the hand fix lift the trigger and
    // restore it exactly as migration 0019 does, inside one transaction.
    const { u2 } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const g = await L.startGateway({ dir: u2, port: 6303, label: 'u2-snap-create', rec });
    gateways.push(g);
    const created = await L.createLoop(
      g.call,
      L.loop('U2 S draft run trigger to exit', [], [L.edge('e1', 'start', 'done')], {
        defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'none' } } },
      }),
    );
    const loopId = created.json.loop.id;
    const draftVersionId = (await g.call(`/loops/${loopId}`)).json.loop.draftVersionId;
    const started = await g.call(`/loops/${loopId}/runs`, {
      method: 'POST',
      body: { input: null, versionId: draftVersionId, allowDraft: true },
    });
    const runId = started.json?.run?.id;
    const run = await L.waitRun(g.call, runId, ['succeeded', 'failed'], 60_000);
    rec.check(
      'S-1 a draft run of a trigger-to-exit loop (no turn) pins a snapshot with loop default none',
      started.status === 202 && run.status === 'succeeded',
      { start: started.status, status: run.status, versionId: run.versionId },
    );
    rec.check('S-2 gateway drains to exit 0', (await g.stop()) === 0, g.exitCode());
    g.copyLog('upgrade-snap-create-gateway.log.txt');
    const snapshotId = run.versionId;
    const trigger = async (db) =>
      (
        await db.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'",
        )
      ).rows[0]?.sql;
    const before = await L.withDb(u2, trigger);
    await L.withDb(u2, async (db) => {
      await db.batch(
        [
          'DROP TRIGGER loop_versions_snapshot_immutable',
          {
            sql: `UPDATE loop_versions SET definition = replace(definition, '"effort":"none"', '"effort":"minimal"') WHERE id = ?`,
            args: [snapshotId],
          },
          SNAPSHOT_TRIGGER,
        ],
        'write',
      );
    });
    const g2 = await L.startGateway({ dir: u2, port: 6304, label: 'u2-snap-minimal', rec });
    gateways.push(g2);
    rec.check(
      'S-3 a stored minimal in a draft snapshot refuses startup, naming the snapshot',
      g2.failedStart?.includes(`stored loop version ${snapshotId} is not a valid definition`) &&
        g2.exitCode() === 1,
      g2.failedStart?.split(/\r?\n/).find((l) => l.includes('Reason:')),
    );
    g2.copyLog('upgrade-snap-minimal-gateway.log.txt');
    const plain = await L.withDb(u2, async (db) => (await db.execute(HAND_FIX[0])).rowsAffected);
    let refusedPlain;
    try {
      await L.withDb(u2, async (db) =>
        db.execute(
          `UPDATE loop_versions SET definition = replace(definition, '"effort":"minimal"', '"effort":"none"') WHERE definition LIKE '%"minimal"%'`,
        ),
      );
    } catch (error) {
      refusedPlain = String(error?.message ?? error).slice(0, 200);
    }
    rec.check(
      'S-4 the ordinary statement skips snapshots (0 rows), and without its status filter the trigger refuses it',
      plain === 0 && /LOOP_VERSION_SNAPSHOT_IMMUTABLE/.test(refusedPlain ?? ''),
      { plain, refusedPlain },
    );
    const fixed = await L.withDb(u2, async (db) => {
      const results = await db.batch(SNAPSHOT_FIX, 'write');
      return results[1].rowsAffected;
    });
    const after = await L.withDb(u2, trigger);
    const g3 = await L.startGateway({ dir: u2, port: 6305, label: 'u2-snap-fixed', rec });
    gateways.push(g3);
    const runRead = await g3.call(`/runs/${runId}`);
    rec.check(
      'S-5 the snapshot hand fix (trigger lifted and restored in one transaction) lets the store start, the run reads back, and the trigger is restored unchanged',
      fixed === 1 && g3.failedStart === undefined && runRead.status === 200 && before === after,
      { fixed, run: runRead.status, triggerRestored: before === after },
    );
    rec.check('S-6 gateway drains to exit 0', (await g3.stop()) === 0, g3.exitCode());
    g3.copyLog('upgrade-snap-fixed-gateway.log.txt');
  } else {
    const { u1, u2, ids } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const u2Versions = (await storedRows(u2)).versions;
    ids.M1V = u2Versions.find((v) => v.name === 'U2 M1 inference luna')?.id;
    ids.M2V = u2Versions.find((v) => v.name === 'U2 M2 draft decision luna')?.id;

    // ---------------- U1 reopened by the WP-205 build ----------------
    const g1 = await L.startGateway({ dir: u1, port: 6302, label: 'u1-head', rec });
    gateways.push(g1);
    const head = await catalog(g1);
    const rows = await storedRows(u1);
    rec.log('head GET /model-catalog', head);
    rec.check(
      'B-1 the startup seed refresh offers none to max for GPT-6 and GPT-5.6, keeps low to xhigh for GPT-5.5 and low to max for Claude (API)',
      [...GPT6, ...GPT56].every((m) => same(head[`codex/${m}`]?.efforts, NONE_TO_MAX)) &&
        same(head['codex/gpt-5.5']?.efforts, LOW_TO_XHIGH) &&
        CLAUDE.every((m) => same(head[`claude/${m}`]?.efforts, LOW_TO_MAX)),
      Object.fromEntries(Object.entries(head).map(([k, v]) => [k, v.efforts])),
    );
    rec.check(
      'B-2 the stored rows hold the same lists, and gpt-6-astra stays disabled while every other row stays enabled',
      rows.catalog.every((r) => {
        const api = head[`${r.harness}/${r.model}`];
        return (
          api &&
          same(JSON.parse(r.efforts), api.efforts) &&
          Boolean(r.enabled) === (r.model !== 'gpt-6-astra')
        );
      }),
      rows.catalog,
    );
    const loops = {};
    for (const k of ['P1', 'P2', 'P3', 'D1']) {
      const r = await g1.call(`/loops/${ids[k]}`);
      loops[k] = { status: r.status, issues: r.json?.issues?.length ?? null };
    }
    const settings = await g1.call('/settings');
    rec.check(
      'B-3 the stored loops and owner defaults read back unchanged',
      Object.values(loops).every((l) => l.status === 200) &&
        same(settings.json?.defaults, {
          byHarness: {
            codex: { model: 'gpt-6-luna', effort: 'low' },
            claude: { model: 'claude-sonnet-5-5', effort: 'high' },
          },
        }),
      { loops, settings: settings.json },
    );
    const luna = await L.createLoop(
      g1.call,
      L.single('U1 head none luna', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'none' })),
    );
    const lunaPublish = luna.json?.loop?.id
      ? await g1.call(`/loops/${luna.json.loop.id}/publish`, { method: 'POST' })
      : { status: null };
    rec.check(
      'B-4 the new build saves and publishes a GPT-6 Luna inference node at none',
      luna.status === 201 && lunaPublish.status === 200,
      { create: L.problemOf(luna), publish: lunaPublish.status },
    );
    const refusals = {
      'inference gpt-5.5 none': await L.createLoop(
        g1.call,
        L.single('U1 none 5.5', L.inferenceNode('work', { model: 'gpt-5.5', effort: 'none' })),
      ),
      'decision gpt-5.5 none': await L.createLoop(
        g1.call,
        L.single('U1 none 5.5 llm', L.llmDecisionNode('work', { model: 'gpt-5.5', effort: 'none' })),
      ),
      'inference claude none': await L.createLoop(
        g1.call,
        L.single(
          'U1 none claude',
          L.inferenceNode('work', { harness: 'claude', model: 'claude-opus-5-5', effort: 'none' }),
        ),
      ),
      'settings gpt-5.5 none': await g1.call('/settings', {
        method: 'PUT',
        body: { defaults: { byHarness: { codex: { model: 'gpt-5.5', effort: 'none' } } } },
      }),
      'settings claude none': await g1.call('/settings', {
        method: 'PUT',
        body: {
          defaults: { byHarness: { claude: { model: 'claude-haiku-5-5', effort: 'none' } } },
        },
      }),
    };
    const refused = Object.fromEntries(
      Object.entries(refusals).map(([k, r]) => [k, L.problemOf(r)]),
    );
    rec.check(
      'B-5 none on GPT-5.5 and on Claude is refused EFFORT_UNSUPPORTED at every save point',
      Object.values(refusals).every((r) => r.status === 400 && r.text.includes('EFFORT_UNSUPPORTED')),
      refused,
    );
    const minimal = await L.createLoop(
      g1.call,
      L.single('U1 minimal', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'minimal' })),
    );
    rec.check(
      'B-6 minimal is not an effort any more: request validation refuses it (400), not the catalog',
      minimal.status === 400 && !minimal.text.includes('EFFORT_UNSUPPORTED'),
      L.problemOf(minimal),
    );
    rec.check('B-7 U1 head gateway drains to exit 0', (await g1.stop()) === 0, g1.exitCode());
    g1.copyLog('upgrade-b-u1-gateway.log.txt');

    // ---------------- U2: a stored minimal, place by place, and the hand fix ----------------
    const u2Start = async (label, port) => {
      const g = await L.startGateway({ dir: u2, port, label, rec });
      gateways.push(g);
      return g;
    };
    const refusedStart = (g, reason) =>
      g.failedStart !== undefined &&
      g.exitCode() === 1 &&
      g.failedStart.includes(reason) &&
      g.failedStart.includes('No stored data was changed');
    const reasonOf = (g) =>
      g.failedStart
        ?.split(/\r?\n/)
        .filter((line) => /Reason:|No stored data|did not start/.test(line))
        .join(' | ');
    const fix = async (index) =>
      L.withDb(u2, async (db) => (await db.execute(HAND_FIX[index])).rowsAffected);
    rec.log('U2 stored rows before the head build opens it', await storedRows(u2));

    // S1: every place holds minimal. The store guard reads loop versions first.
    const s1 = await u2Start('u2-s1-all-minimal', 6303);
    rec.check(
      'B-8 with a stored minimal in a loop version the head build refuses to start, names the version, and changes nothing',
      refusedStart(s1, `stored loop version ${ids.M1V} is not a valid definition`) ||
        refusedStart(s1, `stored loop version ${ids.M2V} is not a valid definition`),
      reasonOf(s1) ?? 'started',
    );
    s1.copyLog('upgrade-b-u2-s1-gateway.log.txt');
    const versionsFixed = await fix(0);

    // S2: loop versions fixed; the owner default still holds minimal.
    const s2 = await u2Start('u2-s2-settings-minimal', 6304);
    rec.check(
      'B-9 with a stored minimal only in the owner defaults the head build refuses to start (owner harness defaults are invalid)',
      versionsFixed === 2 && refusedStart(s2, 'owner harness defaults are invalid'),
      { versionsFixed, reason: reasonOf(s2) ?? 'started' },
    );
    s2.copyLog('upgrade-b-u2-s2-gateway.log.txt');
    const settingsFixed = await fix(1);

    // S3: only the hand-added catalog row holds minimal. The guard does not read the catalog.
    const s3 = await u2Start('u2-s3-catalog-minimal', 6305);
    const s3Reads = { startup: s3.failedStart === undefined ? 'listening' : reasonOf(s3) };
    if (s3.failedStart === undefined) {
      s3Reads.catalog = L.problemOf(await s3.call('/model-catalog'));
      s3Reads.M1 = (await s3.call(`/loops/${ids.M1}`)).status;
      // A run with no inference node: no turn reaches any CLI. It gives the store a run record.
      const plain = await L.publishLoop(
        s3.call,
        L.loop('U2 R trigger to exit', [], [L.edge('e1', 'start', 'done')]),
      );
      const started = await s3.call(`/loops/${plain}/runs`, {
        method: 'POST',
        body: { input: null },
      });
      ids.R = started.json?.run?.id;
      s3Reads.run = (await L.waitRun(s3.call, ids.R, ['succeeded', 'failed'], 60_000)).status;
    }
    rec.observe('B-10 the head build with a stored minimal only in a hand-added catalog row', {
      settingsFixed,
      ...s3Reads,
    });
    rec.check(
      'B-11 U2 (catalog minimal) gateway drains to exit 0',
      (await s3.stop()) === 0,
      s3.exitCode(),
    );
    s3.copyLog('upgrade-b-u2-s3-gateway.log.txt');
    const catalogFixed = await fix(2);

    // S4: every place fixed.
    const s4 = await u2Start('u2-s4-fixed', 6306);
    const fixedReads = {
      catalog: (await s4.call('/model-catalog')).json.items?.find(
        (i) => i.model === 'gpt-5-handadded',
      ),
      settings: (await s4.call('/settings')).json,
      M1: (await s4.call(`/loops/${ids.M1}`)).status,
      M2: (await s4.call(`/loops/${ids.M2}`)).status,
      run: (await s4.call(`/runs/${ids.R}`)).status,
    };
    rec.check(
      'B-12 after the three hand-fix statements the head build reads the catalog row, the owner default and both loops at none',
      catalogFixed === 1 &&
        fixedReads.M1 === 200 &&
        fixedReads.M2 === 200 &&
        fixedReads.run === 200 &&
        same(fixedReads.catalog?.efforts, ['none', 'low', 'medium', 'high']) &&
        fixedReads.catalog?.defaultEffort === 'none' &&
        fixedReads.settings?.defaults?.byHarness?.codex?.effort === 'none',
      { catalogFixed, ...fixedReads },
    );
    rec.check('B-13 U2 fixed gateway drains to exit 0', (await s4.stop()) === 0, s4.exitCode());
    s4.copyLog('upgrade-b-u2-s4-gateway.log.txt');

    // S5: run history that names minimal (the run's pinned owner defaults).
    const pinnedMinimal = await L.withDb(u2, async (db) => {
      const r = await db.execute({
        sql: `UPDATE runs SET pinned = replace(pinned, '"effort":"none"', '"effort":"minimal"') WHERE id = ?`,
        args: [ids.R],
      });
      return r.rowsAffected;
    });
    const s5 = await u2Start('u2-s5-run-minimal', 6307);
    const s5Reads = { pinnedMinimal, startup: s5.failedStart === undefined ? 'listening' : reasonOf(s5) };
    if (s5.failedStart === undefined) {
      s5Reads.run = L.problemOf(await s5.call(`/runs/${ids.R}`));
      s5Reads.list = L.problemOf(await s5.call('/runs'));
    }
    rec.observe('B-14 the head build with a stored minimal only in a run record', s5Reads);
    if (s5.failedStart === undefined) await s5.stop();
    s5.copyLog('upgrade-b-u2-s5-gateway.log.txt');
    const runFixed = await L.withDb(
      u2,
      async (db) => (await db.execute(RUN_FIX)).rowsAffected,
    );
    const s6 = await u2Start('u2-s6-run-fixed', 6308);
    const runRead = await s6.call(`/runs/${ids.R}`);
    rec.check(
      'B-15 the run-record statement fixes it and the run reads back',
      runFixed === 1 && runRead.status === 200,
      { runFixed, run: L.problemOf(runRead) },
    );
    rec.check('B-16 U2 gateway drains to exit 0', (await s6.stop()) === 0, s6.exitCode());
    s6.copyLog('upgrade-b-u2-s6-gateway.log.txt');
    rec.log('U2 stored rows at the end', await storedRows(u2));
  }
} catch (error) {
  rec.check(`upgrade-${phase} completed without exception`, false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
}
