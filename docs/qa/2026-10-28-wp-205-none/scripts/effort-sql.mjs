// The hand correction for a stored `minimal` (#205, ADR-0062), scoped to the contract's typed
// reasoning-effort paths only. Authored JSON elsewhere (variable schemas and defaults, prompts,
// literals, run input, thread values, node outputs) is never matched or changed.
//
// Damaged data is never read and never changed (review round 2). Every json_* call sits inside a
// CASE whose WHEN tests json_valid on the very column it reads, in the SET as well as the WHERE,
// so a malformed sibling column of a row that is corrected stays exactly as it is. SQLite
// evaluates a CASE branch only when it is taken (verified on libsql's SQLite 3.45.1, round2/).
// Arrays are rebuilt only when they hold the expected element type (nodes and diagnostics:
// objects; catalog efforts: strings); a string element would otherwise reach json_extract. A value
// is changed with json_replace on a path chosen by CASE: the path itself when the stored value is
// the string 'minimal', otherwise '$[#]', a position json_replace never finds, so no other value
// is ever re-inserted. The SELECT lists every row whose JSON column is malformed as `unreadable`
// for a repair by hand; a row it still lists after the statements has a damaged shape.
//
// Typed effort paths (packages/contracts/src: common.ts EffortSchema and every schema that embeds
// it, as stored by packages/infrastructure/src/sqlite):
//   loop_versions.definition   $.nodes[*].config.effort              (kind = inference)
//                              $.nodes[*].config.effort.value        (kind = decision, mode explicit)
//                              $.settings.defaults.byHarness.<h>.effort
//   settings.value (defaults)  $.byHarness.<h>.effort
//   model_catalog              efforts[*], default_effort
//   runs.pinned                $.defaults.{owner,process}.byHarness.<h>.effort
//   runs.failure               $.missingSession.effort
//   run_events.payload         run.queued       $.pinned.defaults.{owner,process}.byHarness.<h>.effort
//                              run.failed       $.failure.missingSession.effort
//                              run.resumed      $.freshSession.effort
//                              harness.session  $.effort
//                              decision.made    $.provenance.effort, $.diagnostics[*].provenance.effort
//   harness_sessions.effort
//   webhook_receipts.intent,   $.run.pinned.defaults.{owner,process}.byHarness.<h>.effort
//   event_receipts.intent      $.queued.pinned.defaults.{owner,process}.byHarness.<h>.effort
// <h> is codex or claude (HarnessIdSchema). Thread values and node outputs are JsonValue, not
// typed efforts; receipts never hold a draft snapshot (only manual draft starts do).

const OLD = "'minimal'";
const NEW = "'none'";
const HARNESSES = ['codex', 'claude'];
const sq = (text) => `'${text}'`;

const is = (source, path) => `json_extract(${source}, ${sq(path)}) = ${OLD}`;
/** A predicate over `source`, evaluated only when `source` is valid JSON. */
const valid = (source, predicate) => `CASE WHEN json_valid(${source}) THEN (${predicate}) ELSE 0 END`;
/** A new value for column `source`, computed only when it is valid JSON; otherwise kept as is. */
const keep = (source, expression) =>
  `CASE WHEN json_valid(${source}) THEN ${expression} ELSE ${source} END`;
/** `x` with the string at `path` set to none when `source` holds minimal there; else unchanged. */
const swap = (x, source, path) =>
  `json_replace(${x}, CASE WHEN ${is(source, path)} THEN ${sq(path)} ELSE '$[#]' END, ${NEW})`;
const chainFrom = (start, source, paths) => paths.reduce((x, path) => swap(x, source, path), start);
const chain = (source, paths) => chainFrom(source, source, paths);
/** True when the array at `path` of `source` holds only elements of `type`. */
const arrayOf = (source, path, type) =>
  `json_type(${source}, ${sq(path)}) = 'array' AND NOT EXISTS (SELECT 1 FROM json_each(${source}, ${sq(path)}) WHERE type <> '${type}')`;

const defaultsPaths = (base) => HARNESSES.map((h) => `${base}.${h}.effort`);
const pinnedPaths = (base) =>
  ['owner', 'process'].flatMap((l) => defaultsPaths(`${base}.defaults.${l}.byHarness`));

/** A node (an object element) whose typed effort is minimal. */
const nodeMinimal = (n) =>
  `(json_extract(${n}.value, '$.kind') = 'inference' AND ${is(`${n}.value`, '$.config.effort')}) OR (json_extract(${n}.value, '$.kind') = 'decision' AND json_extract(${n}.value, '$.config.effort.mode') = 'explicit' AND ${is(`${n}.value`, '$.config.effort.value')})`;
const definitionMatch = (d) =>
  [
    ...defaultsPaths('$.settings.defaults.byHarness').map((p) => is(d, p)),
    `EXISTS (SELECT 1 FROM json_each(${d}, '$.nodes') AS n WHERE CASE WHEN n.type = 'object' THEN (${nodeMinimal('n')}) ELSE 0 END)`,
  ].join(' OR ');
/** Valid definition `d` with its typed efforts corrected; nodes are rebuilt only when all objects. */
const definitionFix = (d) => {
  const rebuilt = `json((SELECT json_group_array(json(CASE WHEN json_extract(n.value, '$.kind') = 'inference' AND ${is('n.value', '$.config.effort')} THEN json_set(n.value, '$.config.effort', ${NEW}) WHEN json_extract(n.value, '$.kind') = 'decision' AND json_extract(n.value, '$.config.effort.mode') = 'explicit' AND ${is('n.value', '$.config.effort.value')} THEN json_set(n.value, '$.config.effort.value', ${NEW}) ELSE n.value END) ORDER BY n.key) FROM json_each(${d}, '$.nodes') AS n))`;
  const nodes = `CASE WHEN ${arrayOf(d, '$.nodes', 'object')} THEN json_replace(${d}, '$.nodes', ${rebuilt}) ELSE ${d} END`;
  return chainFrom(nodes, d, defaultsPaths('$.settings.defaults.byHarness'));
};

const PAYLOAD = {
  'run.queued': pinnedPaths('$.pinned'),
  'run.failed': ['$.failure.missingSession.effort'],
  'run.resumed': ['$.freshSession.effort'],
  'harness.session': ['$.effort'],
  'decision.made': ['$.provenance.effort'],
};
const diagnosticsMatch = `EXISTS (SELECT 1 FROM json_each(payload, '$.diagnostics') AS d WHERE CASE WHEN d.type = 'object' THEN ${is('d.value', '$.provenance.effort')} ELSE 0 END)`;
const eventMatch = Object.entries(PAYLOAD)
  .map(
    ([type, paths]) =>
      `(type = '${type}' AND (${[...paths.map((p) => is('payload', p)), ...(type === 'decision.made' ? [diagnosticsMatch] : [])].join(' OR ')}))`,
  )
  .join(' OR ');
const diagnosticsFix = (x) =>
  `CASE WHEN ${arrayOf('payload', '$.diagnostics', 'object')} THEN json_replace(${x}, '$.diagnostics', json((SELECT json_group_array(json(CASE WHEN ${is('d.value', '$.provenance.effort')} THEN json_set(d.value, '$.provenance.effort', ${NEW}) ELSE d.value END) ORDER BY d.key) FROM json_each(payload, '$.diagnostics') AS d))) ELSE ${x} END`;
const eventFix = `CASE type ${Object.entries(PAYLOAD)
  .map(([type, paths]) => {
    const fixed = chain('payload', paths);
    return `WHEN '${type}' THEN ${type === 'decision.made' ? diagnosticsFix(fixed) : fixed}`;
  })
  .join(' ')} ELSE payload END`;

const intentPaths = [...pinnedPaths('$.run.pinned'), ...pinnedPaths('$.queued.pinned')];
const settingsMatch = defaultsPaths('$.byHarness').map((p) => is('value', p)).join(' OR ');
const pinnedMatch = pinnedPaths('$').map((p) => is('pinned', p)).join(' OR ');
const intentMatch = intentPaths.map((p) => is('intent', p)).join(' OR ');
const catalogMatch = `default_effort = ${OLD} OR ${valid('efforts', `EXISTS (SELECT 1 FROM json_each(efforts) WHERE value = ${OLD})`)}`;
const effortsFix = keep(
  'efforts',
  `CASE WHEN ${arrayOf('model_catalog.efforts', '$', 'text')} THEN json((SELECT json_group_array(CASE value WHEN ${OLD} THEN ${NEW} ELSE value END ORDER BY key) FROM json_each(model_catalog.efforts) WHERE NOT (value = ${OLD} AND EXISTS (SELECT 1 FROM json_each(model_catalog.efforts) WHERE value = ${NEW})))) ELSE efforts END`,
);

/** Rows whose JSON column is malformed: never read or changed by the statements. */
const UNREADABLE = [
  ['loop_versions', `id || ' definition'`, 'definition', ''],
  ['settings', `key || ' value'`, 'value', "key = 'defaults' AND "],
  ['model_catalog', `harness || '/' || model || ' efforts'`, 'efforts', ''],
  ['runs', `id || ' pinned'`, 'pinned', ''],
  ['runs', `id || ' failure'`, 'failure', ''],
  ['run_events', `run_id || '#' || seq || ' payload'`, 'payload', ''],
  ['webhook_receipts', `id || ' intent'`, 'intent', ''],
  ['event_receipts', `id || ' intent'`, 'intent', ''],
].map(
  ([table, ref, column, filter]) =>
    `UNION ALL SELECT 'unreadable', '${table} ' || ${ref} FROM ${table} WHERE ${filter}${column} IS NOT NULL AND NOT json_valid(${column})`,
);

/** One statement that lists every stored place naming effort minimal on a typed path. */
export const SELECT = [
  `SELECT 'loop_versions' AS place, id || ' ' || status AS ref FROM loop_versions WHERE ${valid('definition', definitionMatch('definition'))}`,
  `UNION ALL SELECT 'settings', key FROM settings WHERE key = 'defaults' AND ${valid('value', settingsMatch)}`,
  `UNION ALL SELECT 'model_catalog', harness || '/' || model FROM model_catalog WHERE ${catalogMatch}`,
  `UNION ALL SELECT 'runs', id FROM runs WHERE ${valid('pinned', pinnedMatch)} OR ${valid('failure', is('failure', '$.missingSession.effort'))}`,
  `UNION ALL SELECT 'run_events', run_id || '#' || seq || ' ' || type FROM run_events WHERE ${valid('payload', eventMatch)}`,
  `UNION ALL SELECT 'harness_sessions', run_id || '/' || node_id || '/' || attempt FROM harness_sessions WHERE effort = ${OLD}`,
  ...['webhook_receipts', 'event_receipts'].map(
    (table) => `UNION ALL SELECT '${table}', id FROM ${table} WHERE ${valid('intent', intentMatch)}`,
  ),
  ...UNREADABLE,
].join('\n');

/** One UPDATE per place, run with GraphGoblin stopped. */
export const FIX = [
  `UPDATE loop_versions SET definition = ${keep('definition', definitionFix('definition'))} WHERE status <> 'snapshot' AND ${valid('definition', definitionMatch('definition'))}`,
  `UPDATE settings SET value = ${keep('value', chain('value', defaultsPaths('$.byHarness')))} WHERE key = 'defaults' AND ${valid('value', settingsMatch)}`,
  `UPDATE model_catalog SET efforts = ${effortsFix}, default_effort = CASE default_effort WHEN ${OLD} THEN ${NEW} ELSE default_effort END WHERE ${catalogMatch}`,
  `UPDATE runs SET pinned = ${keep('pinned', chain('pinned', pinnedPaths('$')))}, failure = ${keep('failure', chain('failure', ['$.missingSession.effort']))} WHERE ${valid('pinned', pinnedMatch)} OR ${valid('failure', is('failure', '$.missingSession.effort'))}`,
  `UPDATE run_events SET payload = ${keep('payload', eventFix)} WHERE ${valid('payload', eventMatch)}`,
  `UPDATE harness_sessions SET effort = ${NEW} WHERE effort = ${OLD}`,
  ...['webhook_receipts', 'event_receipts'].map(
    (table) =>
      `UPDATE ${table} SET intent = ${keep('intent', chain('intent', intentPaths))} WHERE ${valid('intent', intentMatch)}`,
  ),
];

export const SNAPSHOT_TRIGGER =
  "CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";

/** Draft snapshots are immutable by trigger: lift it, fix, restore it, in one transaction. */
export const SNAPSHOT_FIX = [
  'DROP TRIGGER loop_versions_snapshot_immutable',
  `UPDATE loop_versions SET definition = ${keep('definition', definitionFix('definition'))} WHERE status = 'snapshot' AND ${valid('definition', definitionMatch('definition'))}`,
  SNAPSHOT_TRIGGER,
];

/** The whole recipe as one SQL text (for the record and the CHANGELOG). */
export function recipe() {
  return [
    "-- 1. Find (GraphGoblin may run): every stored place that names effort minimal, and as 'unreadable' every row whose JSON is malformed (repair those by hand; the statements skip them).",
    `${SELECT};`,
    '-- 2. Correct, with every GraphGoblin process stopped: one statement per place.',
    ...FIX.map((statement) => `${statement};`),
    '-- 3. Draft snapshots are immutable by trigger: correct them in one transaction.',
    'BEGIN;',
    ...SNAPSHOT_FIX.map((statement) => `${statement};`),
    'COMMIT;',
    '',
  ].join('\n');
}
