// Offline, read-only comparison of the #419 baseline and candidate native summaries.
// Usage: node compare-native.mjs <baseline summary.json> <candidate summary.json>
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [baselinePath, candidatePath] = process.argv.slice(2);
const load = (path) => {
  const bytes = readFileSync(path);
  return { sha: createHash('sha256').update(bytes).digest('hex'), json: JSON.parse(bytes) };
};
const baseline = load(baselinePath);
const candidate = load(candidatePath);
console.log('baseline sha', baseline.sha, 'phase', baseline.json.phase, 'result', baseline.json.result);
console.log('candidate sha', candidate.sha, 'phase', candidate.json.phase, 'result', candidate.json.result);

const closeCases = Object.keys(candidate.json.cases).filter((name) => name.startsWith('closed-'));
console.log('\n# Disconnect cases (operations entered after response-close, by trace order)');
for (const name of closeCases) {
  for (const [label, summary] of [
    ['base', baseline.json],
    ['cand', candidate.json],
  ]) {
    const value = summary.cases[name];
    const trace = value.trace;
    const closeIndex = trace.findIndex((step) => step.event === 'response-close');
    const close = trace[closeIndex];
    const afterClose = trace.slice(closeIndex + 1);
    const entered = afterClose.filter((step) => step.event === 'operation-entered').map((s) => s.stage);
    const settled = afterClose.filter((step) => step.event === 'operation-settled' || step.event === 'operation-rejected').map((s) => `${s.event.replace('operation-', '')}:${s.stage}`);
    const flaggedAfter = value.operations.filter((op) => op.afterClose).map((op) => `${op.stage}(${op.args.slice(1).join('/')})`);
    const otherEvents = [...new Set(afterClose.map((step) => step.event))];
    const finishedAtClose = close?.responseFinished;
    const snapshots = value.listenerSnapshots?.map((snap) => snap.label ?? snap.at ?? Object.keys(snap).join('|'));
    console.log(
      `${label} ${name.padEnd(26)} stage=${value.stageReached} close@${closeIndex + 1}/${trace.length} finishedAtClose=${finishedAtClose} ` +
        `enteredAfter=[${entered.join(',')}] flaggedAfter=[${flaggedAfter.join(',')}] settledAfter=[${settled.join(',')}] ` +
        `writesAfter=${value.writesAfterClose.length} sendsAfter=${value.attemptedSendsAfterClose.length} errors=${value.errors.length} ` +
        `logs=${JSON.stringify(value.logs.map((log) => [log.level, log.msg]))}`,
    );
    console.log(`     events after close: ${otherEvents.join(',')}`);
    if (label === 'cand') console.log(`     listenerSnapshots: ${JSON.stringify(value.listenerSnapshots)}`);
  }
}

console.log('\n# Positive wires (status, content type, body sha) baseline vs candidate');
for (const name of Object.keys(candidate.json.positives)) {
  const a = baseline.json.positives[name];
  const b = candidate.json.positives[name];
  const bodyA = Buffer.from(a.bodyBase64, 'base64');
  const bodyB = Buffer.from(b.bodyBase64, 'base64');
  const reA = createHash('sha256').update(bodyA).digest('hex');
  const reB = createHash('sha256').update(bodyB).digest('hex');
  const same = a.status === b.status && a.contentType === b.contentType && bodyA.equals(bodyB);
  console.log(
    `${name.padEnd(34)} ${a.status}/${b.status} ${a.contentType === b.contentType ? 'ct=' : 'CT-DIFF'} bytes=${bodyA.length}/${bodyB.length} ` +
      `recomputed=${reA === a.bodySha256 && reB === b.bodySha256 ? 'ok' : 'MISMATCH'} ${same ? 'IDENTICAL' : 'DIFFERENT'}`,
  );
}

console.log('\n# Non-close cases: response observations');
const otherCases = Object.keys(candidate.json.cases).filter((name) => !name.startsWith('closed-'));
for (const name of otherCases) {
  const pick = (value) => {
    if (!value) return 'absent';
    const ops = (value.operations ?? []).map((op) => op.stage).join(',');
    const response = value.response ?? value.wire ?? {};
    const status = value.status ?? response.status;
    let code = value.code ?? response.code;
    if (!code && (value.bodyBase64 || response.bodyBase64)) {
      try {
        code = JSON.parse(Buffer.from(value.bodyBase64 ?? response.bodyBase64, 'base64')).code;
      } catch {}
    }
    const snaps = (value.listenerSnapshots ?? []).length;
    return `status=${status} code=${code} ops=[${ops}] snaps=${snaps}`;
  };
  console.log(`${name.padEnd(34)} base: ${pick(baseline.json.cases[name])}\n${' '.repeat(34)} cand: ${pick(candidate.json.cases[name])}`);
}

console.log('\n# History digests');
for (const [name, value] of Object.entries(candidate.json.history)) {
  const base = baseline.json.history[name];
  console.log(
    `${name.padEnd(16)} cand before=after:${value.beforeReadSha256 === value.afterReadSha256} base before=after:${base.beforeReadSha256 === base.afterReadSha256} cand==base:${value.beforeReadSha256 === base.beforeReadSha256}`,
  );
}

console.log('\n# Bindings (compiled files) baseline vs candidate');
for (const [name, value] of Object.entries(candidate.json.bindings)) {
  const base = baseline.json.bindings[name];
  console.log(`${name.padEnd(12)} ${value.sha256 === base.sha256 ? 'same' : 'CHANGED'} ${value.file}`);
}
console.log('\ncandidate.baseline binding refers to', candidate.json.baseline.directory);
const sameBaselineBindings = Object.entries(candidate.json.baseline.bindings).every(
  ([name, value]) => baseline.json.bindings[name]?.sha256 === value.sha256,
);
console.log('candidate-recorded baseline bindings equal baseline summary bindings:', sameBaselineBindings);
console.log('\ncleanup', JSON.stringify(candidate.json.cleanup, (key, value) => (key === 'stdout' ? undefined : value)));
