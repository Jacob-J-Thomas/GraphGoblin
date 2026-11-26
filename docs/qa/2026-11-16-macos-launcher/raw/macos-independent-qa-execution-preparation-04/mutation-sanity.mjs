#!/usr/bin/env node
// Mutation sanity for offline-oracle-controls.mjs. Node 22 built-ins only, CONTROLLED. Each mutant is a scratch copy
// of driver 04 in a fresh OS temp directory with one exact line re-introducing a defect or a near-miss regression.
// The controls must fail on every mutant, including the named cases. The scratch directory is removed afterwards.
//
//   node mutation-sanity.mjs <driver03.mjs> <driver04.mjs> <QA05 receipt evidence dir>

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [driver03, driver04, evidence] = process.argv.slice(2);
if (!driver03 || !driver04 || !evidence) { process.stderr.write('usage: driver03 driver04 qa05-evidence-dir\n'); process.exit(64); }
const controls = fileURLToPath(new URL('./offline-oracle-controls.mjs', import.meta.url));
const source = await readFile(driver04, 'utf8');
const MUTANTS = [
  ['M1-drain-assertion-reads-GET', 'defect 2 re-introduced: the S4 want reads the pre-drain GET with ?? []',
    "    want(ctx, 'waiting-run-not-unconfirmed', Array.isArray(drained.accepted.unconfirmedRunIds) && !drained.accepted.unconfirmedRunIds.includes(runId),",
    "    want(ctx, 'waiting-run-not-unconfirmed', !(drained.shutdown.unconfirmedRunIds ?? []).includes(runId),",
    ['D2-d04-S4-POST-missing', 'D6-d04-S4-POST-contains-timer-run', 'D7-d04-S4-GET-clean-POST-flags-run', 'D8-d04-S4-GET-flags-run-POST-clean']],
  ['M2-start-omits-version', 'defect 1 re-introduced: the start body omits versionId',
    '    const started = await api(P, \'POST\', `/loops/${loopId}/runs`, start.body);',
    '    const started = await api(P, \'POST\', `/loops/${loopId}/runs`, { allowDraft: true });',
    ['A1-d04-S4-correct-explicit-draft', 'D1-d04-S4-POST-empty-array']],
  ['M3-snapshot-may-equal-draft', 'near miss: run.versionId equal to the submitted draft ID accepted',
    '    ![pin.runId, pin.loopId, start.ids.draftId].includes(pin.versionId) && pin.source === \'draft\' && pin.version === start.ids.draftVersion;',
    '    ![pin.runId, pin.loopId].includes(pin.versionId) && pin.source === \'draft\' && pin.version === start.ids.draftVersion;',
    ['P1-d04-S4-run-version-equals-draft', 'H2-d04-draftRunPin-direct']],
  ['M4-draft-loop-binding-dropped', 'near miss: the draft\'s loop association is not checked',
    '  const ok = ids.loopId !== null && ids.draftId !== null && ids.draftId !== ids.loopId && ids.draftLoopId === ids.loopId &&',
    '  const ok = ids.loopId !== null && ids.draftId !== null && ids.draftId !== ids.loopId &&',
    ['A3-d04-S4-foreign-draft']],
  ['M5-missing-array-coerced', 'near miss: a missing or null POST array is coerced to []',
    '    unconfirmedRunIds: runIds(body?.unconfirmedRunIds), shapes: { activeRunIds: shape(body?.activeRunIds), unconfirmedRunIds: shape(body?.unconfirmedRunIds) },',
    '    unconfirmedRunIds: runIds(body?.unconfirmedRunIds ?? []), shapes: { activeRunIds: shape(body?.activeRunIds), unconfirmedRunIds: shape(body?.unconfirmedRunIds) },',
    ['D2-d04-S4-POST-missing', 'D5-d04-S4-POST-null']],
  ['M6-control-token-recorded', 'near miss: the accepted snapshot keeps controlToken',
    '    graceMs: Number.isFinite(body?.graceMs) ? body.graceMs : null };',
    '    graceMs: Number.isFinite(body?.graceMs) ? body.graceMs : null, controlToken: body?.controlToken };',
    ['A1d-d04-S4-no-control-token-recorded', 'D11-d04-acceptedDrainFields-allowlist']],
  ['M7-config-order-sensitive', 'defect 3 re-introduced: S5 compares the configurations order-sensitively',
    "    want(ctx, 'identical-saved-configuration', sameConfiguration(b.config, ctx.app.a.config),",
    "    want(ctx, 'identical-saved-configuration', JSON.stringify(b.config) === JSON.stringify(ctx.app.a.config),",
    ['S1-d04-S5-reordered-original', 'S2-d04-S5-reordered-nfd']],
  ['M8-config-values-normalized', 'near miss: S5 equality normalizes values to NFC',
    "const sameConfiguration = (a, b) => a !== null && typeof a === 'object' && !Array.isArray(a) && isDeepStrictEqual(a, b);",
    "const sameConfiguration = (a, b) => a !== null && typeof a === 'object' && !Array.isArray(a) && isDeepStrictEqual(JSON.parse(JSON.stringify(a).normalize('NFC')), JSON.parse(JSON.stringify(b ?? null).normalize('NFC')));",
    ['C1-d04-sameConfiguration-direct', 'S5-d04-S5-data-path-other-spelling']],
];
const scratch = await mkdtemp(join(tmpdir(), 'gg456-prep04-mutants-'));
const results = [];
try {
  for (const [id, meaning, from, to, mustFail] of MUTANTS) {
    const at = source.indexOf(from);
    if (at < 0 || source.indexOf(from, at + 1) >= 0) throw new Error(`${id}: the original line is not unique in driver 04`);
    const file = join(scratch, `${id}.mjs`);
    await writeFile(file, source.slice(0, at) + to + source.slice(at + from.length));
    const run = spawnSync(process.execPath, [controls, driver03, file, evidence], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    let parsed = null;
    try { parsed = JSON.parse(run.stdout); } catch { parsed = null; }
    const failed = parsed ? parsed.cases.filter((c) => !c.ok).map((c) => c.id) : null;
    const detected = run.status === 1 && parsed?.pass === false && parsed.guard.restIdentical === true && mustFail.every((c) => failed.includes(c));
    results.push({ id, meaning, exit: run.status, guardRestIdentical: parsed?.guard?.restIdentical ?? null, expectedFailures: mustFail, failed, detected });
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const pass = results.every((r) => r.detected);
process.stdout.write(JSON.stringify({ schema: 'gg456-prep04-mutation-sanity/1', controlled: true, node: process.version, mutants: results, pass }, null, 2) + '\n');
process.exitCode = pass ? 0 : 1;
