// The hand correction for a stored `minimal` (#205, ADR-0062), scoped to the contract's typed
// reasoning-effort paths only. Authored JSON elsewhere (variable schemas and defaults, prompts,
// literals, run input, thread values, node outputs) is never matched or changed. Every statement
// guards json_* calls with json_valid, so a damaged row is skipped, never an error.
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

/** `x` with the string at `path` changed from minimal to none; absent paths stay absent. */
const swap = (x, source, path) =>
  `json_replace(${x}, ${sq(path)}, CASE json_extract(${source}, ${sq(path)}) WHEN ${OLD} THEN ${NEW} ELSE json_extract(${source}, ${sq(path)}) END)`;
const is = (source, path) => `json_extract(${source}, ${sq(path)}) = ${OLD}`;
const valid = (source, predicate) => `CASE WHEN json_valid(${source}) THEN (${predicate}) ELSE 0 END`;
/** Apply `swap` for each path to `start`, reading the old values from `source`. */
const chainFrom = (start, source, paths) => paths.reduce((x, path) => swap(x, source, path), start);
const chain = (source, paths) => chainFrom(source, source, paths);

const defaultsPaths = (base) => HARNESSES.map((h) => `${base}.${h}.effort`);
const pinnedPaths = (base) => ['owner', 'process'].flatMap((l) => defaultsPaths(`${base}.defaults.${l}.byHarness`));

const nodeMatch = (n) =>
  `(json_extract(${n}.value, '$.kind') = 'inference' AND ${is(`${n}.value`, '$.config.effort')}) OR (json_extract(${n}.value, '$.kind') = 'decision' AND json_extract(${n}.value, '$.config.effort.mode') = 'explicit' AND ${is(`${n}.value`, '$.config.effort.value')})`;
const definitionMatch = (d) =>
  [
    ...defaultsPaths('$.settings.defaults.byHarness').map((p) => is(d, p)),
    `EXISTS (SELECT 1 FROM json_each(${d}, '$.nodes') AS n WHERE ${nodeMatch('n')})`,
  ].join(' OR ');
const definitionFix = (d) => {
  const nodes = `json((SELECT json_group_array(json(CASE WHEN json_extract(n.value, '$.kind') = 'inference' AND ${is('n.value', '$.config.effort')} THEN json_set(n.value, '$.config.effort', ${NEW}) WHEN json_extract(n.value, '$.kind') = 'decision' AND json_extract(n.value, '$.config.effort.mode') = 'explicit' AND ${is('n.value', '$.config.effort.value')} THEN json_set(n.value, '$.config.effort.value', ${NEW}) ELSE n.value END) ORDER BY n.key) FROM json_each(${d}, '$.nodes') AS n))`;
  return chainFrom(
    `json_replace(${d}, '$.nodes', ${nodes})`,
    d,
    defaultsPaths('$.settings.defaults.byHarness'),
  );
};

const PAYLOAD = {
  'run.queued': pinnedPaths('$.pinned'),
  'run.failed': ['$.failure.missingSession.effort'],
  'run.resumed': ['$.freshSession.effort'],
  'harness.session': ['$.effort'],
  'decision.made': ['$.provenance.effort'],
};
const diagnosticsMatch = `EXISTS (SELECT 1 FROM json_each(payload, '$.diagnostics') AS d WHERE ${is('d.value', '$.provenance.effort')})`;
const eventMatch = Object.entries(PAYLOAD)
  .map(
    ([type, paths]) =>
      `(type = '${type}' AND (${[...paths.map((p) => is('payload', p)), ...(type === 'decision.made' ? [diagnosticsMatch] : [])].join(' OR ')}))`,
  )
  .join(' OR ');
const eventFix = `CASE type ${Object.entries(PAYLOAD)
  .map(([type, paths]) => {
    const fixed = chain('payload', paths);
    return `WHEN '${type}' THEN ${
      type === 'decision.made'
        ? `json_replace(${fixed}, '$.diagnostics', json((SELECT json_group_array(json(CASE WHEN ${is('d.value', '$.provenance.effort')} THEN json_set(d.value, '$.provenance.effort', ${NEW}) ELSE d.value END) ORDER BY d.key) FROM json_each(payload, '$.diagnostics') AS d)))`
        : fixed
    }`;
  })
  .join(' ')} ELSE payload END`;

const intentPaths = [...pinnedPaths('$.run.pinned'), ...pinnedPaths('$.queued.pinned')];
const catalogMatch = `default_effort = ${OLD} OR ${valid('efforts', `EXISTS (SELECT 1 FROM json_each(efforts) WHERE value = ${OLD})`)}`;

/** One statement that lists every stored place naming effort minimal on a typed path. */
export const SELECT = [
  `SELECT 'loop_versions' AS place, id || ' ' || status AS ref FROM loop_versions WHERE ${valid('definition', definitionMatch('definition'))}`,
  `UNION ALL SELECT 'settings', key FROM settings WHERE key = 'defaults' AND ${valid('value', defaultsPaths('$.byHarness').map((p) => is('value', p)).join(' OR '))}`,
  `UNION ALL SELECT 'model_catalog', harness || '/' || model FROM model_catalog WHERE ${catalogMatch}`,
  `UNION ALL SELECT 'runs', id FROM runs WHERE ${valid('pinned', pinnedPaths('$').map((p) => is('pinned', p)).join(' OR '))} OR ${valid('failure', is('failure', '$.missingSession.effort'))}`,
  `UNION ALL SELECT 'run_events', run_id || '#' || seq || ' ' || type FROM run_events WHERE ${valid('payload', eventMatch)}`,
  `UNION ALL SELECT 'harness_sessions', run_id || '/' || node_id || '/' || attempt FROM harness_sessions WHERE effort = ${OLD}`,
  ...['webhook_receipts', 'event_receipts'].map(
    (table) =>
      `UNION ALL SELECT '${table}', id FROM ${table} WHERE ${valid('intent', intentPaths.map((p) => is('intent', p)).join(' OR '))}`,
  ),
].join('\n');

/** One UPDATE per place, run with GraphGoblin stopped. */
export const FIX = [
  `UPDATE loop_versions SET definition = ${definitionFix('definition')} WHERE status <> 'snapshot' AND ${valid('definition', definitionMatch('definition'))}`,
  `UPDATE settings SET value = ${chain('value', defaultsPaths('$.byHarness'))} WHERE key = 'defaults' AND ${valid('value', defaultsPaths('$.byHarness').map((p) => is('value', p)).join(' OR '))}`,
  `UPDATE model_catalog SET efforts = json((SELECT json_group_array(CASE value WHEN ${OLD} THEN ${NEW} ELSE value END ORDER BY key) FROM json_each(model_catalog.efforts) WHERE NOT (value = ${OLD} AND EXISTS (SELECT 1 FROM json_each(model_catalog.efforts) WHERE value = ${NEW})))), default_effort = CASE default_effort WHEN ${OLD} THEN ${NEW} ELSE default_effort END WHERE ${catalogMatch}`,
  `UPDATE runs SET pinned = ${chain('pinned', pinnedPaths('$'))}, failure = ${chain('failure', ['$.missingSession.effort'])} WHERE ${valid('pinned', pinnedPaths('$').map((p) => is('pinned', p)).join(' OR '))} OR ${valid('failure', is('failure', '$.missingSession.effort'))}`,
  `UPDATE run_events SET payload = ${eventFix} WHERE ${valid('payload', eventMatch)}`,
  `UPDATE harness_sessions SET effort = ${NEW} WHERE effort = ${OLD}`,
  ...['webhook_receipts', 'event_receipts'].map(
    (table) =>
      `UPDATE ${table} SET intent = ${chain('intent', intentPaths)} WHERE ${valid('intent', intentPaths.map((p) => is('intent', p)).join(' OR '))}`,
  ),
];

export const SNAPSHOT_TRIGGER =
  "CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";

/** Draft snapshots are immutable by trigger: lift it, fix, restore it, in one transaction. */
export const SNAPSHOT_FIX = [
  'DROP TRIGGER loop_versions_snapshot_immutable',
  `UPDATE loop_versions SET definition = ${definitionFix('definition')} WHERE status = 'snapshot' AND ${valid('definition', definitionMatch('definition'))}`,
  SNAPSHOT_TRIGGER,
];

/** The whole recipe as one SQL text (for the record and the CHANGELOG). */
export function recipe() {
  return [
    '-- 1. Find (GraphGoblin may run): every stored place that names effort minimal.',
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
