// D7 adjacent preserved contracts A01-A03 over the built API (PUBLIC-API + real poll scheduler).
// A01 poll fireWhen stays a pre-run trigger policy; A02 poll item key stays an item rejection;
// A03 event dedupe stays a request-side 422. No run, run.failed or authored boundary is created.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, recorder, containsAny } from './lib/rec.mjs';
import { boot, sleep } from './lib/boot.mjs';

const r = recorder('d7');
const t = await boot({ name: 'd7', port: 5877 });
r.raw('resources', { driverPid: process.pid, apiPort: 5877, dataDir: t.dataDir });
const runsOf = async (loopId) => ((await t.rest('GET', '/runs?limit=500')).json?.items ?? []).filter((x) => x.loopId === loopId);
const loopWith = (name, trigger) => ({ name, nodes: [{ id: 'start', kind: 'trigger', label: 'Start', config: trigger }, { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"ok"' } }], edges: [{ id: 'e0', from: { node: 'start', port: 'out' }, to: { node: 'done' } }] });
async function pub(id, def) {
  const p = await t.publish(def);
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const a01 = await pub('A01', loopWith('a01', { type: 'poll', intervalSeconds: 5, probe: { kind: 'none' }, fireWhen: '$error("QA486-LIT-A01")' }));
const a01c = await pub('A01c', loopWith('a01c', { type: 'poll', intervalSeconds: 5, probe: { kind: 'none' }, fireWhen: 'true', dedupeKey: '"once"' }));
const a02 = await pub('A02', loopWith('a02', { type: 'poll', intervalSeconds: 5, probe: { kind: 'none' }, fireWhen: 'true', items: { select: '[{"a":1}]', dedupeKey: '$error("QA486-LIT-A02")' } }));
const a03 = await pub('A03', loopWith('a03', { type: 'event', eventType: 'qa-a03', dedupeKey: '$error("QA486-LIT-A03")' }));
const a03c = await pub('A03c', loopWith('a03c', { type: 'event', eventType: 'qa-a03c', dedupeKey: 'k' }));
if (a03) {
  const ev = await t.rest('POST', '/events', { loopId: a03, type: 'qa-a03', payload: { k: 'x' } });
  await sleep(300);
  r.check('A03', 'event dedupe expression failure stays a request-side 422 (fixed copy, literal absent), zero runs', ev.status === 422 && (await runsOf(a03)).length === 0 && containsAny(ev.json, ['QA486-LIT-A03']).length === 0, { status: ev.status, body: ev.json }, 'PUBLIC-API');
}
if (a03c) {
  const ev = await t.rest('POST', '/events', { loopId: a03c, type: 'qa-a03c', payload: { k: 'x' } });
  await sleep(1000);
  r.check('A03c', 'valid event dedupe control accepted (202) and starts one run', ev.status === 202 && (await runsOf(a03c)).length === 1, { status: ev.status }, 'PUBLIC-API');
}
await sleep(12000);
if (a01) {
  const runs = await runsOf(a01);
  const logs = t.logger.lines.filter((l) => JSON.stringify(l.obj).includes(a01));
  r.check('A01', 'poll fireWhen failure stays a pre-run trigger policy: zero runs, private warn only, literal not logged', runs.length === 0 && logs.length >= 1 && containsAny(logs, ['QA486-LIT-A01']).length === 0, { runs: runs.length, logs: logs.slice(0, 3) }, 'PUBLIC-API+SCHEDULER');
}
if (a01c) r.check('A01c', 'poll control with fireWhen true starts exactly one deduplicated run', (await runsOf(a01c)).length === 1, { runs: (await runsOf(a01c)).map((x) => x.status) }, 'PUBLIC-API+SCHEDULER');
if (a02) {
  const runs = await runsOf(a02);
  const logs = t.logger.lines.filter((l) => JSON.stringify(l.obj).includes(a02));
  r.check('A02', 'poll item key failure stays an item rejection/admission diagnostic: zero runs, no literal logged', runs.length === 0 && logs.length >= 1 && containsAny(logs, ['QA486-LIT-A02']).length === 0, { runs: runs.length, logs: logs.slice(0, 3) }, 'PUBLIC-API+SCHEDULER');
}
writeFileSync(join(OUT, 'd7.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; port refuses', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5877, dataDir: t.dataDir });
process.exit(0);
