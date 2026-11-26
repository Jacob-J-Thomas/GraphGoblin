// Preparation 04 portless API-contract check. CONTROLLED ROUTE-CONTRACT EVIDENCE, NOT NATIVE ACCEPTANCE.
// It drives the repository's own portless Fastify composition (createTestApp: real routes, RunManager and SQLite
// repositories over an in-memory store, fake harnesses, timers not started) through app.inject. No listener, provider,
// installer, gateway process or network. The S4 fixture definition and the request/oracle helpers are the exact
// driver 04 declaration bytes, evaluated from ../gg456-native-qa.mjs, so the requests below are the driver's own.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createTestApp } from 'C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin/apps/api/src/testing/test-app.ts';

const driverUrl = new URL('../gg456-native-qa.mjs', import.meta.url);
const outUrl = new URL('./draft-start.portless.observations.json', import.meta.url);
const sha = (value) => createHash('sha256').update(value).digest('hex');

function extract(source, names) {
  const parts = [];
  for (const name of names) {
    const start = new RegExp(`^(?:async function|function|const|class) ${name}\\b`, 'mu').exec(source);
    if (!start) throw new Error('declaration not found: ' + name);
    let end;
    if (/^const /u.test(start[0])) {
      let at = start.index;
      for (;;) { const nl = source.indexOf('\n', at); if (source.slice(at, nl).trimEnd().endsWith(';')) { end = nl; break; } at = nl + 1; }
    } else end = source.indexOf('\n}\n', start.index) + 2;
    parts.push(source.slice(start.index, end));
  }
  return parts.join('\n');
}
const driverBytes = await readFile(driverUrl);
const names = ['ULID', 'WAIT_SECONDS', 'waitLoop', 'ulidOrNull', 'draftStart', 'draftRunPin', 'acceptedDrainFields'];
// eslint-disable-next-line no-new-func
const d = new Function(extract(driverBytes.toString('utf8'), names) + `\nreturn { ${names.join(', ')} };`)();

let t;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

it('S4 draft start: create 201, omitted version 404, explicit draft 202, new immutable snapshot, flat run, list and drain snapshot', async () => {
  const obs = { schema: 'gg456-prep04-portless-draft-start/1', controlled: true, nativeAcceptance: false, node: process.version,
    driverSha256: sha(driverBytes), extracted: names };
  t = await createTestApp();
  const definition = d.waitLoop({ runId: '7c5ae3c2' });
  obs.fixture = { name: definition.name, waitSeconds: d.WAIT_SECONDS, definitionSha256: sha(JSON.stringify(definition)) };

  // 1. The exact driver fixture creates a draft-only loop.
  const made = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
  expect(made.statusCode, made.body).toBe(201);
  const created = made.json();
  const start = d.draftStart(created);
  obs.create = { status: made.statusCode, issues: created.issues, loopHasCurrentVersionId: 'currentVersionId' in created.loop,
    draftStatus: created.draft.status, draftVersion: created.draft.version, draftStartOk: start.ok,
    loopDraftVersionIdIsDraft: created.loop.draftVersionId === created.draft.id, draftLoopIdIsLoop: created.draft.loopId === created.loop.id };
  expect(created.issues).toEqual([]);
  expect(created.loop.currentVersionId).toBeUndefined();
  expect(start.ok).toBe(true);
  expect(start.body).toEqual({ versionId: created.draft.id, allowDraft: true });
  const loopId = created.loop.id;
  const draftId = created.draft.id;

  // 2. The driver 03 request ({allowDraft:true}, no versionId) is refused exactly as QA05 observed.
  const old = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: { allowDraft: true } });
  obs.omittedVersion = { status: old.statusCode, code: old.json().code, detail: old.json().detail?.replace(loopId, '<loop>') };
  expect(old.statusCode, old.body).toBe(404);
  expect(old.json().code).toBe('LOOP_NOT_FOUND');
  expect(old.json().detail).toContain('has no published version');
  const noAllow = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: { versionId: draftId } });
  obs.draftWithoutAllowDraft = { status: noAllow.statusCode, code: noAllow.json().code };
  expect(noAllow.statusCode, noAllow.body).toBe(409);
  expect(noAllow.json().code).toBe('VERSION_NOT_PUBLISHED');

  // 3. The corrected request is the driver's start.body.
  const started = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: start.body });
  expect(started.statusCode, started.body).toBe(202);
  const run = started.json().run;
  const admitted = d.draftRunPin(run, start);
  obs.explicitDraft = { status: started.statusCode, responseKeys: Object.keys(started.json()), runStatus: run.status, pinOk: admitted.ok,
    versionIdDiffersFromDraft: run.versionId !== draftId, pinned: { source: run.pinned.source, version: run.pinned.version, label: run.pinned.label } };
  expect(Object.keys(started.json())).toEqual(['run']);
  expect(admitted.ok).toBe(true);
  expect(d.ULID.test(run.id)).toBe(true);
  expect(run.loopId).toBe(loopId);
  expect(run.versionId).not.toBe(draftId);
  expect(run.pinned.source).toBe('draft');

  // 4. The pinned version is a new immutable snapshot; the draft itself is unchanged and still the loop's draft.
  const snapshot = await t.app.inject(`/loops/${loopId}/versions/${run.versionId}`);
  const detail = await t.app.inject(`/loops/${loopId}`);
  const versions = await t.app.inject(`/loops/${loopId}/versions`);
  const restart = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: { versionId: run.versionId, allowDraft: true } });
  obs.snapshot = { status: snapshot.statusCode, versionStatus: snapshot.json().status, loopId: snapshot.json().loopId === loopId,
    definitionEqualsDraft: isDeepStrictEqual(snapshot.json().definition, created.draft.definition),
    loopDraftUnchanged: detail.json().draft?.id === draftId && detail.json().loop.draftVersionId === draftId && !('current' in detail.json()),
    listedInVersionHistory: versions.json().items.some((v) => v.id === run.versionId), startSnapshotDirectly: { status: restart.statusCode, code: restart.json().code } };
  expect(snapshot.statusCode, snapshot.body).toBe(200);
  expect(snapshot.json().status).toBe('snapshot');
  expect(obs.snapshot.definitionEqualsDraft).toBe(true);
  expect(obs.snapshot.loopDraftUnchanged).toBe(true);
  expect(obs.snapshot.listedInVersionHistory).toBe(false);
  expect(restart.statusCode, restart.body).toBe(409);
  expect(restart.json().code).toBe('VERSION_NOT_PUBLISHED');

  // 5. GET /runs/{id} is the flat snapshot the driver polls: waiting on a durable timer, same pin projection.
  await t.idle();
  const flat = await t.app.inject(`/runs/${run.id}`);
  const body = flat.json();
  const kept = d.draftRunPin(body, start);
  obs.flatRun = { status: flat.statusCode, runStatus: body.status, flat: !('run' in body) && body.id === run.id, hasRecovery: 'recovery' in body,
    waitingKind: body.waiting?.kind ?? null, hasUntil: typeof body.waiting?.until === 'string', samePin: kept.ok && isDeepStrictEqual(kept.pin, admitted.pin) };
  expect(flat.statusCode, flat.body).toBe(200);
  expect(obs.flatRun.flat).toBe(true);
  expect(body.status).toBe('waiting');
  expect(body.waiting?.kind).toBe('timer');
  expect(obs.flatRun.hasUntil).toBe(true);
  expect(obs.flatRun.hasRecovery).toBe(true);
  expect(obs.flatRun.samePin).toBe(true);

  // 6. GET /loops lists the loop with its run (the driver's loop-retained predicate, verbatim, plus exact count).
  const loops = await t.app.inject('/loops');
  const item = (loops.json().items ?? []).find((i) => i.id === loopId);
  obs.list = { status: loops.statusCode, driverPredicate: (loops.json()?.items ?? []).some((i) => i.id === loopId && i.runCount >= 1),
    runCount: item?.runCount ?? null, latestRunIsRun: item?.latestRun?.id === run.id, latestRunStatus: item?.latestRun?.status ?? null };
  expect(loops.statusCode).toBe(200);
  expect(obs.list.driverPredicate).toBe(true);
  expect(item.runCount).toBe(1);
  expect(obs.list.latestRunIsRun).toBe(true);

  // 7. The real drain responses: the pre-drain GET and the accepted 202 are separate snapshots; the driver keeps only
  // allowlisted members of the 202, and the parked timer run is not reported unconfirmed.
  const before = await t.app.inject('/system/shutdown');
  const token = before.json().controlToken;
  const drain = await t.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'drain' }, headers: { 'x-graphgoblin-shutdown-token': token } });
  const accepted = d.acceptedDrainFields(drain.json());
  obs.drain = { getStatus: before.statusCode, getPhase: before.json().phase, getUnconfirmedIsArray: Array.isArray(before.json().unconfirmedRunIds),
    postStatus: drain.statusCode, postKeys: Object.keys(drain.json()).sort(), accepted,
    timerRunNotUnconfirmed: Array.isArray(accepted.unconfirmedRunIds) && !accepted.unconfirmedRunIds.includes(run.id),
    tokenRecorded: JSON.stringify(accepted).includes(token) || JSON.stringify(accepted).includes(drain.json().controlToken) };
  expect(before.json().phase).toBe('running');
  expect(drain.statusCode, drain.body).toBe(202);
  expect(Array.isArray(drain.json().unconfirmedRunIds)).toBe(true);
  expect(obs.drain.timerRunNotUnconfirmed).toBe(true);
  expect(obs.drain.tokenRecorded).toBe(false);
  expect('controlToken' in accepted).toBe(false);

  await writeFile(outUrl, JSON.stringify(obs, null, 2) + '\n');
});
