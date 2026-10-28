// WP-205 review round 2: the published recipe (read from the CHANGELOG) on a copy of a real
// product-schema store (the last places.mjs store: every typed place, receipts and a draft
// snapshot), with `minimal` on the typed paths and, at the same time, damage in every JSON column
// the statements read: malformed JSON, and valid JSON of the wrong shape. Every statement must
// complete; damaged cells must stay byte for byte; valid typed values beside them must be
// corrected; the SELECT must list malformed rows as unreadable before and after, and keep listing
// a wrong-shaped row that still names minimal. No gateway, no provider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('round2/guards');

function changelogRecipe() {
  const lines = fs.readFileSync(path.join(L.ROOT, 'CHANGELOG.md'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith('- Effort `none` (no reasoning)'));
  const open = lines.indexOf('  ```sql', at);
  const close = lines.indexOf('  ```', open + 1);
  const text = lines.slice(open + 1, close).map((l) => l.replace(/^ {2}/, '')).join('\n');
  const find = text.split('-- 2.')[0].replace(/^--.*\n/, '').trim().replace(/;$/, '');
  return { find, correct: '-- 2.' + text.split('-- 2.')[1] };
}

const source = fs
  .readdirSync(os.tmpdir())
  .filter((n) => n.startsWith('gg-205-places-'))
  .map((n) => path.join(os.tmpdir(), n))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const dir = L.makeStore('guards');
for (const suffix of ['', '-wal', '-shm']) {
  const file = path.join(source, `graphgoblin.db${suffix}`);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, `graphgoblin.db${suffix}`));
}
const N = `'"effort":"none"'`;
const M = `'"effort":"minimal"'`;
const TRIGGER =
  "CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";

try {
  const { find, correct } = changelogRecipe();
  const result = await L.withDb(dir, async (db) => {
    const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
    const cell = async (table, column, where, args = []) =>
      (await one(`SELECT ${column} AS v FROM ${table} WHERE ${where}`, args))?.v ?? null;
    // Typed minimal everywhere (as places.mjs F writes it).
    await db.execute(`UPDATE loop_versions SET definition = replace(replace(definition, ${N}, ${M}), '"effort":{"mode":"explicit","value":"none"}', '"effort":{"mode":"explicit","value":"minimal"}') WHERE status <> 'snapshot'`);
    await db.execute(`UPDATE runs SET pinned = replace(pinned, ${N}, ${M}), failure = replace(failure, ${N}, ${M})`);
    await db.execute(`UPDATE run_events SET payload = replace(payload, ${N}, ${M}) WHERE type IN ('run.queued', 'run.failed', 'run.resumed', 'harness.session', 'decision.made')`);
    await db.execute(`UPDATE harness_sessions SET effort = 'minimal'`);
    await db.execute(`UPDATE event_receipts SET intent = replace(intent, ${N}, ${M})`);
    // Targets.
    const versions = (await db.execute(`SELECT id FROM loop_versions WHERE status = 'published' ORDER BY id`)).rows.map((r) => r.id);
    const draft = (await one(`SELECT id FROM loop_versions WHERE status = 'draft'`)).id;
    const missing = (await db.execute(`SELECT id FROM runs WHERE failure IS NOT NULL ORDER BY id`)).rows.map((r) => r.id);
    const pinnedOnly = (await db.execute(`SELECT id FROM runs WHERE failure IS NULL ORDER BY id`)).rows.map((r) => r.id);
    const session = await one(`SELECT run_id, seq FROM run_events WHERE type = 'harness.session' ORDER BY run_id, seq`);
    const decision = await one(`SELECT run_id, seq FROM run_events WHERE type = 'decision.made'`);
    const webhook = (await one('SELECT id FROM webhook_receipts')).id;
    const event = (await one('SELECT id FROM event_receipts')).id;
    // Damage, one kind per column the statements read.
    const damage = [];
    const set = async (label, table, column, where, args, value) => {
      await db.execute({ sql: `UPDATE ${table} SET ${column} = ? WHERE ${where}`, args: [value, ...args] });
      damage.push({ label, table, column, where, args, value });
    };
    await set('D1 malformed catalog efforts beside default minimal (review case 1)', 'model_catalog', 'efforts', "model = 'gpt-6-sol'", [], 'not-json');
    await db.execute(`UPDATE model_catalog SET default_effort = 'minimal' WHERE model = 'gpt-6-sol'`);
    await set('D2 malformed failure beside a pinned minimal (review case 2)', 'runs', 'failure', 'id = ?', [pinnedOnly[0]], 'not-json');
    await set('D3 malformed pinned beside a missing-session minimal (review case 3)', 'runs', 'pinned', 'id = ?', [missing[0]], 'not-json');
    await set('D4 malformed published definition', 'loop_versions', 'definition', 'id = ?', [versions[0]], '{"nodes":');
    await set('D5 nodes holding a string element beside an inference node at minimal', 'loop_versions', 'definition', 'id = ?', [draft], JSON.stringify({ schemaVersion: 4, settings: {}, nodes: ['abc', { id: 'w', kind: 'inference', config: { effort: 'minimal' } }] }));
    await set('D6 malformed owner defaults', 'settings', 'value', "key = 'defaults'", [], '[');
    await set('D7 malformed harness.session payload', 'run_events', 'payload', 'run_id = ? AND seq = ?', [session.run_id, session.seq], '{"effort":');
    const decisionPayload = JSON.parse(await cell('run_events', 'payload', 'run_id = ? AND seq = ?', [decision.run_id, decision.seq]));
    decisionPayload.diagnostics = ['abc', { code: 'x', provenance: { effort: 'minimal' } }];
    await db.execute({ sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = ?', args: [JSON.stringify(decisionPayload), decision.run_id, decision.seq] });
    // Only the diagnostics array is damaged; the provenance beside it is a valid typed value.
    damage.push({ label: 'D8 decision diagnostics holding a string element', table: 'run_events', column: "json_extract(payload, '$.diagnostics')", where: 'run_id = ? AND seq = ?', args: [decision.run_id, decision.seq], value: JSON.stringify(decisionPayload.diagnostics) });
    await set('D9 malformed webhook receipt intent', 'webhook_receipts', 'intent', 'id = ?', [webhook], 'not-json');
    await db.execute(`INSERT INTO model_catalog (harness, model, source, display_name, efforts, default_effort, enabled) VALUES ('codex', 'shape-object', 'harness', 'Object', '{"a":"minimal"}', 'low', 1), ('codex', 'shape-number', 'harness', 'Number', '["minimal",3]', 'low', 1)`);
    damage.push({ label: 'D10 catalog efforts that are an object', table: 'model_catalog', column: 'efforts', where: "model = 'shape-object'", args: [], value: '{"a":"minimal"}' });
    damage.push({ label: 'D11 catalog efforts holding a number', table: 'model_catalog', column: 'efforts', where: "model = 'shape-number'", args: [], value: '["minimal",3]' });
    const objectPin = JSON.parse(await cell('runs', 'pinned', 'id = ?', [pinnedOnly[1]]));
    objectPin.defaults.owner.byHarness.codex = { model: 'gpt-6-luna', effort: { odd: 'minimal' } };
    objectPin.defaults.process.byHarness.codex = { model: 'gpt-6-luna', effort: 'minimal' };
    await db.execute({ sql: 'UPDATE runs SET pinned = ? WHERE id = ?', args: [JSON.stringify(objectPin), pinnedOnly[1]] });
    await db.batch(['DROP TRIGGER loop_versions_snapshot_immutable', `UPDATE loop_versions SET definition = '"oops' WHERE status = 'snapshot'`, TRIGGER], 'write');
    damage.push({ label: 'D12 malformed draft snapshot', table: 'loop_versions', column: 'definition', where: "status = 'snapshot'", args: [], value: '"oops' });

    const before = (await db.execute(find)).rows.map((r) => `${r.place} ${r.ref}`);
    let error = null;
    try {
      await db.executeMultiple(correct);
    } catch (e) {
      error = String(e.message);
    }
    const after = (await db.execute(find)).rows.map((r) => `${r.place} ${r.ref}`);
    const damaged = [];
    for (const d of damage) damaged.push({ label: d.label, unchanged: (await cell(d.table, d.column, d.where, d.args)) === d.value });
    const siblings = {
      'D2 pinned beside the malformed failure': JSON.parse(await cell('runs', 'pinned', 'id = ?', [pinnedOnly[0]])).defaults.owner.byHarness.codex?.effort,
      'D3 failure beside the malformed pinned': JSON.parse(await cell('runs', 'failure', 'id = ?', [missing[0]])).missingSession.effort,
      'D8 decision provenance beside string diagnostics': JSON.parse(await cell('run_events', 'payload', 'run_id = ? AND seq = ?', [decision.run_id, decision.seq])).provenance.effort,
      'D1 catalog default beside malformed efforts': await cell('model_catalog', 'default_effort', "model = 'gpt-6-sol'"),
      'object effort kept, process effort corrected': JSON.stringify(JSON.parse(await cell('runs', 'pinned', 'id = ?', [pinnedOnly[1]])).defaults),
      // Typed paths of the stored admission corrected; its authored thread payload keeps minimal.
      'event receipt intent': (() => {
        return cell('event_receipts', 'intent', 'id = ?', [event]).then((text) => {
          const intent = JSON.parse(text);
          const typed = ['run', 'queued'].flatMap((k) =>
            ['owner', 'process'].flatMap((l) =>
              ['codex', 'claude'].map((h) => intent[k]?.pinned?.defaults?.[l]?.byHarness?.[h]?.effort),
            ),
          );
          return !typed.includes('minimal') && typed.includes('none') && text.includes('"authored":{"effort":"minimal"}')
            ? 'corrected'
            : JSON.stringify({ typed });
        });
      })(),
      'harness_sessions left at minimal': (await one(`SELECT count(*) AS n FROM harness_sessions WHERE effort = 'minimal'`)).n,
    };
    siblings['event receipt intent'] = await siblings['event receipt intent'];
    const trigger = (await one("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'"))?.sql;
    const expectedRemaining = [`loop_versions ${draft} draft`, "model_catalog codex/shape-number", "model_catalog codex/shape-object", `run_events ${decision.run_id}#${decision.seq} decision.made`].sort();
    return { error, before, after, damaged, siblings, triggerRestored: trigger === TRIGGER, expectedRemaining };
  });
  const unreadable = (rows) => rows.filter((r) => r.startsWith('unreadable ')).sort();
  rec.check('G-1 the whole published recipe completes on the damaged store: no statement fails', result.error === null, { error: result.error });
  rec.check('G-2 every damaged cell (malformed or wrong-shaped) is byte for byte unchanged', result.damaged.every((d) => d.unchanged), result.damaged);
  rec.check(
    'G-3 valid typed values beside damaged cells are corrected',
    result.siblings['D2 pinned beside the malformed failure'] === 'none' &&
      result.siblings['D3 failure beside the malformed pinned'] === 'none' &&
      result.siblings['D8 decision provenance beside string diagnostics'] === 'none' &&
      result.siblings['D1 catalog default beside malformed efforts'] === 'none' &&
      result.siblings['object effort kept, process effort corrected'].includes('"effort":{"odd":"minimal"}') &&
      result.siblings['object effort kept, process effort corrected'].includes('"process":{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"none"}') &&
      result.siblings['event receipt intent'] === 'corrected' &&
      result.siblings['harness_sessions left at minimal'] === 0 &&
      result.triggerRestored,
    { ...result.siblings, triggerRestored: result.triggerRestored },
  );
  rec.check(
    'G-4 the SELECT lists the eight malformed cells as unreadable before and after the statements',
    unreadable(result.before).length === 8 && JSON.stringify(unreadable(result.before)) === JSON.stringify(unreadable(result.after)),
    { unreadable: unreadable(result.after) },
  );
  const remaining = result.after.filter((r) => !r.startsWith('unreadable ')).sort();
  rec.check(
    'G-5 after the statements the SELECT lists only the unreadable cells and the wrong-shaped rows that still name minimal (D5 nodes, D8 diagnostics, D10, D11)',
    JSON.stringify(remaining) === JSON.stringify(result.expectedRemaining),
    { remaining, expected: result.expectedRemaining, beforeRows: result.before.length },
  );
} catch (error) {
  rec.check('guards completed without exception', false, String(error?.stack ?? error));
} finally {
  rec.finish({ source, store: dir });
}
