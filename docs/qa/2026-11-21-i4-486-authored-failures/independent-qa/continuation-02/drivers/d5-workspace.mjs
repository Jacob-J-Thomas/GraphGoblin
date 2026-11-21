// D5 workspace templates and terminal file return (PUBLIC-API + NATIVE fs/script; storage receipt
// faults are SCRIPTED-STORAGE).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OUT, WORK, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain, counterLines, FIXTURE_APPEND, NODE_EXE, countType } from './lib/boot.mjs';
import { failureParity, authoredShape, TEMPLATE_RENDER } from './lib/checks.mjs';

const r = recorder('d5');
const t = await boot({ name: 'd5', port: 5874 });
r.raw('resources', { driverPid: process.pid, apiPort: 5874, dataDir: t.dataDir, cwd: process.cwd() });
const sinks = join(WORK, 'sinks');
mkdirSync(sinks, { recursive: true });
const root = join(WORK, 'wsroot');
mkdirSync(root, { recursive: true });
const counter = (n) => join(sinks, `${n}.counter.jsonl`);
const inc = (p) => `{% include "QA486-PATH-${p}" %}`;
const EMPTY = 'The template rendered to an empty path. Supply a nonempty directory.';
async function scenario(id, fn) {
  try { await fn(); } catch (error) { r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION'); }
}
async function publishOk(id, def) {
  const p = await t.publish(def);
  r.raw(`${id}-publish`, { status: p.published?.status, created: p.created?.status, body: p.ok ? undefined : p.published?.json ?? p.created?.json });
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const script = (id, c, tag) => ({ id, kind: 'script', label: id, config: { command: NODE_EXE, args: [FIXTURE_APPEND, c, tag], stdin: 'none', stdout: 'ignore' } });
const fileExit = (path = 'out.json') => ({ returns: '"QA-W-result"', destinations: [{ kind: 'file', path, format: 'json' }] });
const settings = (wd) => ({ workingDirectory: wd });
const sameDir = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const listing = (d) => (existsSync(d) ? readdirSync(d) : null);

async function wsSuccess(tag, wd, input, expectedDir) {
  const c = counter(tag);
  const loop = await publishOk(tag, chain(tag, [script('s1', c, `${tag}-1`), script('s2', c, `${tag}-2`)], fileExit(), settings(wd)));
  if (!loop) return;
  const res = await t.run(loop, input);
  const evs = await t.events(res.id);
  const lines = counterLines(c);
  const dir = expectedDir(res.id);
  const out = join(dir, 'out.json');
  const delivered = evs.filter((e) => e.type === 'return.delivered');
  r.check(tag, 'succeeded; both scripts ran in the same expected directory (cache/reuse); file return written there byte-exact; one return.delivered with that target', res.snapshot.status === 'succeeded' && lines.length === 2 && lines.every((l) => sameDir(l.cwd, dir)) && existsSync(out) && readFileSync(out, 'utf8') === JSON.stringify('QA-W-result', null, 2) && delivered.length === 1 && sameDir(delivered[0].target, out), { status: res.snapshot.status, failure: res.snapshot.failure, cwds: lines.map((l) => l.cwd), dir, outExists: existsSync(out), delivered }, 'NATIVE');
  return res;
}
await scenario('W-T', () => wsSuccess('W-T', { kind: 'template', template: '  {{ trigger.payload.dir }}\n' }, { dir: join(root, 'tmpl-dir') }, () => join(root, 'tmpl-dir')));
await scenario('W-F', () => wsSuccess('W-F', { kind: 'fixed', path: join(root, 'fixed-dir') }, {}, () => join(root, 'fixed-dir')));
await scenario('W-R', () => wsSuccess('W-R', { kind: 'fixed', path: 'rel-ws-dir' }, {}, () => resolve(process.cwd(), 'rel-ws-dir')));
await scenario('W-TMP', () => wsSuccess('W-TMP', { kind: 'temp' }, {}, (id) => join(t.dataDir, 'workspaces', id)));
await scenario('W-REUSE', async () => {
  // Second run with the same template directory reuses the existing directory (no error on existing).
  const res = await wsSuccess('W-REUSE', { kind: 'template', template: '{{ trigger.payload.dir }}' }, { dir: join(root, 'tmpl-dir') }, () => join(root, 'tmpl-dir'));
  if (res) r.check('W-REUSE-dir', 'shared template directory reused across runs', existsSync(join(root, 'tmpl-dir')), { entries: listing(join(root, 'tmpl-dir')) }, 'NATIVE');
});

async function wsFailure(tag, wd, input, cause) {
  const c = counter(tag);
  const before = listing(root);
  const loop = await publishOk(tag, chain(tag, [script('s1', c, tag)], { returns: '"x"' }, settings(wd)));
  if (!loop) return;
  const res = await t.run(loop, input);
  authoredShape(r, tag, res.snapshot.failure, { code: 'TEMPLATE_ERROR', nodeId: 's1', boundary: 'settings.workingDirectory.template', cause, message: (cc) => `Working directory template failed. ${cc}` }, 'PUBLIC-API+NATIVE');
  r.check(`${tag}-native`, 'no script run (counter +0), no temp workspace for the run, no new directory under the workspace root', counterLines(c).length === 0 && !existsSync(join(t.dataDir, 'workspaces', res.id)) && JSON.stringify(listing(root)) === JSON.stringify(before), { lines: counterLines(c).length, before, after: listing(root) }, 'NATIVE');
  await failureParity(t, r, res.id, res.snapshot, { tag, effects: async () => ({ lines: counterLines(c).length, root: listing(root) }) });
}
await scenario('W-E', () => wsFailure('W-E', { kind: 'template', template: '  {{ trigger.payload.missing }}  ' }, { m: 'QA486-IN-WE' }, EMPTY));
await scenario('W-L', () => wsFailure('W-L', { kind: 'template', template: `${root}/${inc('WL')}` }, {}, TEMPLATE_RENDER));

// ---------------- B26 terminal file return ----------------
async function fileReturn(tag, wd, input, expectFn, opts = {}) {
  const loop = await publishOk(tag, chain(tag, [], fileExit(opts.path), settings(wd)));
  if (!loop) return;
  const res = await t.run(loop, input);
  const evs = await t.events(res.id);
  expectFn(res, evs);
  return { res, evs };
}
await scenario('B26-empty', () => fileReturn('B26-empty', { kind: 'template', template: '{{ trigger.payload.missing }}' }, { m: 'QA486-IN-B26' }, (res, evs) => {
  const failed = evs.filter((e) => e.type === 'return.failed');
  r.check('B26-empty', 'exit file return with empty workspace render: run succeeded unchanged; one return.failed with the fixed safe workspace message; no run.failed; no return.delivered', res.snapshot.status === 'succeeded' && failed.length === 1 && failed[0].error === `Working directory template failed. ${EMPTY}` && countType(evs, 'run.failed') === 0 && countType(evs, 'return.delivered') === 0 && containsAny(failed, ['QA486-IN']).length === 0, { status: res.snapshot.status, failed, types: evs.map((e) => e.type) }, 'PUBLIC-API');
}));
await scenario('B26-liquid', () => fileReturn('B26-liquid', { kind: 'template', template: `${root}/${inc('B26')}` }, {}, (res, evs) => {
  const failed = evs.filter((e) => e.type === 'return.failed');
  r.check('B26-liquid', 'Liquid workspace fault at delivery: succeeded run, one return.failed with fixed safe Liquid message, include name absent', res.snapshot.status === 'succeeded' && failed.length === 1 && /^Working directory template failed\. The template could not be rendered/.test(failed[0].error) && !failed[0].error.includes('QA486-PATH') && countType(evs, 'run.failed') === 0, { failed }, 'PUBLIC-API');
}));
await scenario('B26c', () => fileReturn('B26c', { kind: 'template', template: '{{ trigger.payload.dir }}' }, { dir: join(root, 'b26c') }, (res, evs) => {
  const out = join(root, 'b26c', 'out.json');
  r.check('B26c', 'valid file return: return.delivered, file bytes exact', res.snapshot.status === 'succeeded' && countType(evs, 'return.delivered') === 1 && existsSync(out) && readFileSync(out, 'utf8') === JSON.stringify('QA-W-result', null, 2), { types: evs.map((e) => e.type) }, 'NATIVE');
}));
await scenario('B26x', async () => {
  const dir = join(root, 'b26x');
  mkdirSync(join(dir, 'out.json'), { recursive: true });
  await fileReturn('B26x', { kind: 'fixed', path: dir }, {}, (res, evs) => {
    const failed = evs.filter((e) => e.type === 'return.failed');
    r.check('B26x', 'unexpected write error keeps existing raw describeError receipt text (positive raw control); run status unchanged', res.snapshot.status === 'succeeded' && failed.length === 1 && /EISDIR|directory/i.test(failed[0].error) && statSync(join(dir, 'out.json')).isDirectory(), { failed }, 'NATIVE');
  });
});
for (const afterCommit of [false, true]) {
  const tag = `B26-receipt-${afterCommit ? 'after' : 'before'}`;
  await scenario(tag, async () => {
    const dir = join(root, tag);
    const loop = await publishOk(tag, chain(tag, [], fileExit(), settings({ kind: 'fixed', path: dir })));
    if (!loop) return;
    let target;
    t.eventFault.afterCommit = afterCommit; t.eventFault.times = 1;
    t.eventFault.match = (runId, drafts) => (target === undefined || runId === target) && drafts.some((d) => d.type === 'return.delivered');
    const started = await t.rest('POST', `/loops/${loop}/runs`, { input: {} });
    target = started.json.run.id;
    const snap = await t.settle(target, ['succeeded', 'failed']);
    await new Promise((res) => setTimeout(res, 500));
    t.eventFault.match = undefined;
    const evs = await t.events(target);
    const out = join(dir, 'out.json');
    r.check(tag, `success-receipt append fault ${afterCommit ? 'after' : 'before'} commit: file written, terminal status unchanged, receipts recorded per existing catch, no second delivery attempt`, snap.status === 'succeeded' && existsSync(out) && readFileSync(out, 'utf8') === JSON.stringify('QA-W-result', null, 2) && countType(evs, 'run.failed') === 0 && countType(evs, 'return.delivered') + countType(evs, 'return.failed') <= 2, { status: snap.status, receipts: evs.filter((e) => e.type.startsWith('return.')), fired: t.eventFault.log.slice(-1) }, 'SCRIPTED-STORAGE+NATIVE');
  });
}

// ---------------- W-OWN (best-effort): deletion eligibility preview of temp vs fixed runs ----------------
await scenario('W-OWN', async () => {
  const runs = (await t.rest('GET', '/runs?limit=200')).json?.items ?? [];
  const preview = await t.rest('POST', '/runs/deletion-eligibility/preview', { runIds: runs.slice(0, 50).map((x) => x.id) });
  r.check('W-OWN', 'deletion-eligibility preview reachable (best-effort ownership evidence recorded)', preview.status < 500, { status: preview.status, body: JSON.stringify(preview.json).slice(0, 3000) }, 'PUBLIC-API');
});

writeFileSync(join(OUT, 'd5.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; API port refuses connections', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5874, dataDir: t.dataDir });
process.exit(0);
