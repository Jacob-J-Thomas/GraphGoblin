// D2b: engine-level JSONata variants at one real authored site (heartbeat.until, probe none) over
// the built API. All runtime rejections must use the fixed evaluation copy; only depth/time get their
// own fixed reason; successful/untaken forms succeed. (PUBLIC-API)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain } from './lib/boot.mjs';
import { failureParity, authoredShape, EXPR_EVAL } from './lib/checks.mjs';

const r = recorder('d2b');
const t = await boot({ name: 'd2b', port: 5877 });
r.raw('resources', { driverPid: process.pid, apiPort: 5877, dataDir: t.dataDir });
const DEPTH = 'The expression exceeded its nesting limit. Reduce its recursion or nesting.';
const TIME = 'The expression exceeded its time limit. Reduce the work it performs.';
const hb = (until) => chain('d2b', [{ id: 'h', kind: 'heartbeat', label: 'h', config: { intervalSeconds: 1, maxBeats: 2, probe: { kind: 'none' }, until } }]);
const cases = [
  ['literal', '$error("QA486-LIT-V1")', EXPR_EVAL],
  ['grouped', '($x := 1; $error("QA486-LIT-V2"))', EXPR_EVAL],
  ['cond-taken', 'beat = 1 ? $error("QA486-LIT-V3") : true', EXPR_EVAL],
  ['nested', '($f := function($v){ $error("QA486-LIT-V4") }; $f(1))', EXPR_EVAL],
  ['dynamic', '$error("QA486-" & thread.trigger.payload.m)', EXPR_EVAL],
  ['assert', '$assert(false, "QA486-LIT-V6")', EXPR_EVAL],
  ['length', '$error("QA486-LIT-V7" & $pad("", 5000, "x"))', EXPR_EVAL],
  ['chars', '$error("QA486-LIT-V8 \\n \\" <script>alert(1)</script> \\u2603")', EXPR_EVAL],
  ['type', '$length(123)', EXPR_EVAL],
  ['eval-malformed', '$eval("1 +")', EXPR_EVAL],
  ['eval-unsafe', '$eval("$match(\\"aaaa\\", /(a+)+$/)")', EXPR_EVAL],
  ['eval-input', '$eval(thread.trigger.payload.src)', EXPR_EVAL],
  ['depth', '($f := function($n){ $n = 0 ? 0 : 1 + $f($n - 1) }; $f(500) > 0)', DEPTH],
  ['time', '$count($map([1..3000000], function($v){ $v * 2 })) > 0', TIME],
];
for (const [k, until, cause] of cases) {
  try {
    const p = await t.publish(hb(until));
    if (!p.ok) { r.check(`V-${k}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP'); continue; }
    const res = await t.run(p.loopId, { m: 'IN-V5', src: '1 + ' }, { waitFor: ['failed', 'succeeded'], timeoutMs: 60000 });
    authoredShape(r, `V-${k}`, res.snapshot.failure, { code: 'EXPRESSION_ERROR', nodeId: 'h', boundary: 'heartbeat.until', indices: { beat: 1 }, cause, message: (c) => `Heartbeat until predicate, beat 1 failed. ${c}` });
    await failureParity(t, r, res.id, res.snapshot, { tag: `V-${k}` });
  } catch (error) {
    r.check(`V-${k}-crash`, 'scenario completed', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION');
  }
}
for (const [k, until] of [['cond-untaken', 'beat = 2 ? $error("QA486-LIT-V9") : true'], ['eval-valid', '$eval("1 = 1")'], ['predicate-array', '[1]'], ['predicate-object', '{"a":1}']]) {
  const p = await t.publish(hb(until));
  const res = p.ok ? await t.run(p.loopId, {}, { waitFor: ['failed', 'succeeded'] }) : undefined;
  r.check(`V-${k}`, 'successful/untaken form keeps ordinary result (succeeded at beat 1)', res?.snapshot?.status === 'succeeded', { status: res?.snapshot?.status, failure: res?.snapshot?.failure, publish: p.ok }, 'PUBLIC-API');
}
const hits = t.logger.lines.filter((l) => /QA486-(LIT|IN)/.test(JSON.stringify(l.obj) + l.msg));
r.check('LOG', 'no captured log record contains QA486-LIT/IN (evaluator message neither published nor logged at the new site)', hits.length === 0, { hits: hits.map((h) => JSON.stringify(h).slice(0, 400)) }, 'SCRIPTED-LOGGER');
writeFileSync(join(OUT, 'd2b.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; port refuses', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5877, dataDir: t.dataDir });
process.exit(0);
