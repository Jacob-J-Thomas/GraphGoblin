// Public SQLite admission port with two concurrent calls within one process.
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCandidateBinding } from './binding.mjs';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const [admissionPath, attempt] = process.argv.slice(2);
assert.match(attempt ?? '', /^race-attempt-[1-9][0-9]*$/);
const spec = JSON.parse(await readFile(admissionPath,'utf8'));
assert.equal(spec.status,'CORRECTED_NATIVE_ADMITTED');
assert.equal(spec.raceAttempt,attempt);
const binding = await readCandidateBinding(spec);
const loadBuilt = (file) => import(pathToFileURL(join(binding.checkout,file)).href);
const {SqliteTriggerAdmission, SqliteEventStore, openDatabase} = await loadBuilt('packages/infrastructure/dist/sqlite/index.js');
const {createInitialThread} = await loadBuilt('packages/engine/dist/index.js');
const {fakeUlid,FIXTURE_IDS,FIXTURE_TS,samplePin} = await loadBuilt('packages/contracts/dist/testing/index.js');

const out = join(root,attempt);
await mkdir(out);
assert.equal(await realpath(out),out);
const data = join(out,'disposable-store');
await mkdir(data);
assert.equal(await realpath(data),data);
const db = join(data,'poll.sqlite');
const readback = {phase:'concurrent public item admission against file SQLite',
  candidate:spec.head, pid:process.pid, createdAt:new Date(performance.timeOrigin).toISOString(), data, db};
const clock = {now:() => new Date(FIXTURE_TS)};
const key = 'race-key-\uFFFD-\uD83D\uDE00';
const keyUnits = key.split('').map((unit) => unit.charCodeAt(0).toString(16).padStart(4,'0')).join(' ');
function intent(label) {
  const run = {id:fakeUlid('race-' + label), ownerId:'local', loopId:FIXTURE_IDS.loop,
    versionId:FIXTURE_IDS.version, invocationId:fakeUlid('race-invocation-' + label),
    pinned:samplePin(), status:'queued', iteration:1, createdAt:FIXTURE_TS, lastEventSeq:0};
  const initialThread = createInitialThread({
    runId:run.id, loopId:run.loopId, versionId:run.versionId,
    invocation:{id:run.invocationId, source:'poll', trigger:{nodeId:'poll',kind:'poll',
      payload:{candidate:label}, receivedAt:FIXTURE_TS, dedupeKey:key}},
  });
  return {run,initialThread,pinnedLoopIds:[run.loopId],queued:{type:'run.queued',
    versionId:run.versionId,pinned:run.pinned,initialThread}};
}
let handle;
let failure;
try {
  handle = openDatabase({url:pathToFileURL(db).href});
  await handle.migrate();
  const events = new SqliteEventStore(handle.db,clock);
  const service = new SqliteTriggerAdmission(handle.db,events,clock);
  const intents = ['a','b'].map(intent);
  const attempted = intents.map(({run}) => run.id);
  assert.equal(new Set(attempted).size,2);
  const notifications = Object.fromEntries(attempted.map((id) => [id,[]]));
  const unsubs = attempted.map((id) => events.subscribe(id, (event) => notifications[id].push(event.seq)));
  const startedAtMs = performance.now();
  const outcomes = await Promise.allSettled(intents.map((input) => service.createPollItem(input)));
  const stoppedAtMs = performance.now();
  unsubs.forEach((unsub) => unsub());
  readback.callWindow = {startedAtMs,stoppedAtMs};
  readback.attempted = attempted;
  readback.outcomes = outcomes.map((outcome) => outcome.status === 'fulfilled' ?
    {fulfilled:true, admitted:outcome.value !== undefined, id:outcome.value?.id ?? null} :
    {fulfilled:false, problem:{name:outcome.reason?.name,code:outcome.reason?.code,message:outcome.reason?.message}});
  readback.notifications = notifications;
  assert(outcomes.every(({status}) => status === 'fulfilled'));
  const winners = readback.outcomes.filter(({admitted}) => admitted);
  assert.equal(winners.length,1);
  const winner = winners[0].id;
  const loser = attempted.find((id) => id !== winner);
  assert(attempted.includes(winner) && loser);
  assert.deepEqual(notifications[winner],[1]);
  assert.deepEqual(notifications[loser],[]);
  const readEvents = await Promise.all(attempted.map(async (id) => [id,await events.read(id)]));
  readback.events = Object.fromEntries(readEvents);
  assert.equal(readback.events[winner].length,1);
  assert.equal(readback.events[winner][0].type,'run.queued');
  assert.deepEqual(readback.events[loser],[]);
  const found = await handle.client.execute({
    sql:'SELECT id, owner_id, loop_id, version_id, initial_thread FROM runs WHERE loop_id = ?',
    args:[FIXTURE_IDS.loop],
  });
  assert.equal(found.rows.length,1);
  const row = found.rows[0];
  assert.equal(row.id,winner);
  assert.equal(row.owner_id,'local');
  assert.equal(row.version_id,FIXTURE_IDS.version);
  const initialThread = JSON.parse(row.initial_thread);
  assert.equal(initialThread.invocation.trigger.nodeId,'poll');
  assert.equal(initialThread.invocation.trigger.dedupeKey,key);
  assert.deepEqual(readback.events[winner][0].initialThread,initialThread);
  readback.durable = {winner,loser,keyUnits,initialThread,queuedCount:1};
} catch (error) {
  failure = {name:error.name, message:error.message, stack:error.stack};
} finally {
  handle?.close();
}
try {
  assert.deepEqual(await readCandidateBinding(spec),binding);
} catch (error) {
  failure ??= {name:error.name, message:error.message, stack:error.stack};
}
readback.finishedAt = new Date().toISOString();
readback.failure = failure ?? null;
await writeFile(join(out,'result.json'),JSON.stringify(readback,null,2) + '\n',{flag:'wx'});
if (failure) {
  process.stderr.write(failure.message + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('One admission and queued event, one duplicate outcome, file SQLite closed.\n');
}
