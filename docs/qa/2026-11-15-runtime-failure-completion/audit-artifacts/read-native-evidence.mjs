import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as eq } from 'node:util';
const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const base = path.join(repo, 'docs/qa/2026-11-15-runtime-failure-candidate');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const report = { at: new Date().toISOString(), kind: 'independent offline readback of existing raw observations; no product execution', functional: [], internal: [] };
const expected = json(path.join(batch, 'runtime-381-functional-candidate-root-acceptance.json'));
for (const c of expected.rawCases) {
  const dir = path.join(base, 'functional/corrected-attempt-1', c.id);
  const raw = json(path.join(dir, 'before-recovery.json'));
  const stored = raw.raw.rows.find(r => r.id === raw.run.id);
  const failed = raw.events.find(e => e.type === 'run.failed');
  const failedSql = raw.raw.events.find(e => e.type === 'run.failed');
  const final = raw.events.find(e => e.type === 'run.failed' || e.type === 'run.finished');
  const observation = { id: c.id, runId: raw.run.id, status: raw.run.status, failure: raw.run.failure ?? null, lastEventSeq: raw.run.lastEventSeq, terminalSeq: final?.seq, tailSeq: raw.events.at(-1)?.seq,
    expectedStatusAndCode: raw.run.status === c.status && (raw.run.failure?.code ?? null) === c.code,
    failureRowMatches: eq(raw.run.failure ?? null, stored.failure === null ? null : JSON.parse(stored.failure)),
    failureEventMatches: failed ? eq(raw.run.failure, failed.failure) && eq(raw.run.failure, JSON.parse(failedSql.payload).failure) : !failedSql,
    sequenceMatches: raw.run.lastEventSeq === stored.last_event_seq && raw.run.lastEventSeq === raw.events.at(-1)?.seq && raw.run.lastEventSeq === raw.raw.events.at(-1)?.seq,
    failedNodeNotCommitted: failed ? !raw.events.some(e => e.type === 'node.finished' && e.nodeId === raw.run.failure.nodeId) : null,
    resume: raw.run.recovery.resume,
  };
  if (raw.run.failure?.code === 'MUTATION_ERROR') observation.correctIdentity = raw.run.failure.resumable === false && raw.run.failure.message.includes('operation ' + (raw.run.failure.details.operationIndex + 1) + ' (' + raw.run.failure.details.operationKind + ')');
  report.functional.push(observation);
}
const internalDir = path.join(base, 'internal/evidence-candidate-first');
for (const filename of fs.readdirSync(internalDir).filter(p => p.endsWith('.json') && !p.endsWith('.private.json') && p !== 'summary.json')) {
  const c = json(path.join(internalDir, filename));
  if (!c.observations) continue;
  const privateLogs = json(path.join(internalDir, filename.replace('.json', '.private.json')));
  const cases = Object.entries(c.observations).filter(([, value]) => value?.snapshot && value?.raw).map(([name, value]) => {
    const failure = value.snapshot.failure;
    const event = value.events.findLast(e => e.type === 'run.failed');
    const sqlEvent = value.raw.events.findLast(e => e.type === 'run.failed');
    return { observation: name, status: value.snapshot.status, failure: failure ?? null, sequence: value.snapshot.lastEventSeq,
      failureRowMatches: eq(failure ?? null, value.raw.run.failure === null ? null : JSON.parse(value.raw.run.failure)),
      terminalFailureMatches: value.snapshot.status === 'failed' ? eq(failure, event?.failure) && eq(failure, sqlEvent ? JSON.parse(sqlEvent.payload).failure : undefined) : null,
      decodedAndSqlEventIdentitiesMatch: eq(value.events.map(e => [e.seq,e.type,e.nodeId ?? null]), value.raw.events.map(e => [e.seq,e.type,e.node_id])),
      recovery: value.snapshot.recovery.resume,
      lastEvents: value.events.slice(-4).map(e => [e.seq,e.type,e.nodeId ?? null]),
    };
  });
  const result = { file: filename, result: c.result, observations: cases, cleanup: { closed: c.store.closed, empty: c.store.empty, remaining: c.store.remaining },
    privateCorrelations: privateLogs.filter(e => e.obj?.error || e.obj?.diagnostics).map(e => ({ level:e.level, message:e.msg, runId:e.obj.runId,nodeId:e.obj.nodeId,childRunId:e.obj.childRunId,turnId:e.obj.turnId,operation:e.obj.operation, diagnostic:e.obj.error ?? e.obj.diagnostics })) };
  if (c.observations.legacyLeafBefore) result.originalLeafRowsAndEventsUnchanged = eq(c.observations.legacyLeafBefore, c.observations.leafTerminal.raw);
  if (c.observations.legacyMiddleBefore) result.originalMiddleRowsAndEventsUnchanged = eq(c.observations.legacyMiddleBefore, c.observations.middleTerminal.raw);
  if (c.observations.terminal && c.observations.resumed) result.originalEventPrefixUnchanged = eq(c.observations.terminal.raw.events, c.observations.resumed.raw.events.slice(0, c.observations.terminal.raw.events.length));
  report.internal.push(result);
}
fs.writeFileSync(path.join(batch, 'review-485-astra-scan2/native-evidence-readback.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({functionalCount:report.functional.length, functionalChecks:report.functional.map(c=>({id:c.id,code:c.failure?.code ?? null,matched:c.expectedStatusAndCode&&c.failureRowMatches&&c.failureEventMatches&&c.sequenceMatches&&(c.failedNodeNotCommitted!==false)&&(c.correctIdentity!==false)})),internalCount:report.internal.length,internalChecks:report.internal.map(c=>({file:c.file,observations:c.observations.length,result:c.result,durableFailuresMatch:c.observations.every(o=>o.failureRowMatches&&o.terminalFailureMatches!==false&&o.decodedAndSqlEventIdentitiesMatch),originalLeaf:c.originalLeafRowsAndEventsUnchanged,originalMiddle:c.originalMiddleRowsAndEventsUnchanged,originalPrefix:c.originalEventPrefixUnchanged,privateEntries:c.privateCorrelations.length,cleanup:c.cleanup}))},null,2));
