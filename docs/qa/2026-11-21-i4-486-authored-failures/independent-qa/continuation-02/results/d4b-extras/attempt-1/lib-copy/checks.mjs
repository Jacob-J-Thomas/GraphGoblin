// 02-owned shared assertions for authored-failure rows over the public API + durable store.
import { containsAny } from './rec.mjs';
import { countType } from './boot.mjs';

export function canon(value) {
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canon(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export const TEMPLATE_RENDER = /^The template could not be rendered( at line \d+, column \d+)?\. Check its filters and input values\.$/;
export const EXPR_EVAL = 'The expression could not evaluate this input. Check its input type and mapping.';
export const TIMESTAMP = 'The value must render to a timestamp. Check the template and date format.';
export const AFTER = ' GraphGoblin received the provider result before this step failed.';
export const CANARIES = ['QA486-LIT', 'QA486-IN', 'QA486-PATH', 'QA486-EXT'];

/**
 * Durable parity and recovery for one failed run: stored row failure == run.failed failure ==
 * REST snapshot failure; recovery refused; an actual Resume attempt returns 409 and adds no event.
 */
export async function failureParity(t, r, id, snap, { tag, refuse = true, cls = 'PUBLIC-API+SQLITE', markers = CANARIES, effects } = {}) {
  const row = await t.container.repos.runs.get(id);
  const evs = await t.events(id);
  const failed = evs.filter((e) => e.type === 'run.failed');
  const restFailure = snap?.failure;
  r.check(`${tag}-parity`, 'stored row failure == run.failed failure == REST snapshot failure (canonical JSON)', failed.length === 1 && canon(row?.failure) === canon(failed[0]?.failure) && canon(failed[0]?.failure) === canon(restFailure), { row: row?.failure, event: failed.map((e) => e.failure), rest: restFailure }, cls);
  const leaks = containsAny([row?.failure, failed.map((e) => e.failure), restFailure], markers);
  r.check(`${tag}-privacy`, `new authored projection omits canaries ${markers.join('/')}`, leaks.length === 0, { leaks }, cls);
  if (!refuse) return { row, evs, failed };
  const allowed = snap?.recovery?.resume?.allowed;
  const before = JSON.stringify(evs);
  const beforeEffects = effects ? await effects() : undefined;
  const resume = await t.rest('POST', `/runs/${id}/resume`, { observedSeq: snap?.recovery?.observedSeq ?? 0 });
  await new Promise((res) => setTimeout(res, 300));
  const after = JSON.stringify(await t.events(id));
  const afterEffects = effects ? await effects() : undefined;
  r.check(`${tag}-resume-refused`, 'recovery.resume.allowed false; actual Resume 409 FAILURE_NOT_RESUMABLE; events and effects unchanged after it', allowed === false && resume.status === 409 && resume.json?.code === 'FAILURE_NOT_RESUMABLE' && before === after && canon(beforeEffects) === canon(afterEffects), { allowed, resumeStatus: resume.status, resumeBody: resume.json, eventsUnchanged: before === after, beforeEffects, afterEffects }, cls);
  return { row, evs, failed };
}

export function authoredShape(r, tag, failure, expect, cls = 'PUBLIC-API') {
  const d = failure?.details ?? {};
  const problems = [];
  if (failure?.code !== expect.code) problems.push(`code ${failure?.code}`);
  if (failure?.resumable !== false) problems.push(`resumable ${failure?.resumable}`);
  if (expect.nodeId && failure?.nodeId !== expect.nodeId) problems.push(`nodeId ${failure?.nodeId}`);
  if (d.boundary !== expect.boundary) problems.push(`boundary ${d.boundary}`);
  for (const [k, v] of Object.entries(expect.indices ?? {})) if (d[k] !== v) problems.push(`${k} ${d[k]}`);
  const cause = d.cause?.message ?? '';
  if (expect.cause instanceof RegExp ? !expect.cause.test(cause) : cause !== expect.cause) problems.push(`cause ${cause}`);
  if (expect.message && failure?.message !== expect.message(cause)) problems.push(`message ${failure?.message}`);
  for (const k of ['childRunId', 'childNodeId', 'childDetails']) if (k in d) problems.push(`reserved key ${k}`);
  if (expect.phase !== undefined ? d.phase !== expect.phase : 'phase' in d) problems.push(`phase ${d.phase}`);
  return r.check(`${tag}-shape`, `${expect.code} ${expect.boundary} ${JSON.stringify(expect.indices ?? {})} resumable false, fixed cause/message`, problems.length === 0, { problems, failure }, cls);
}

export { countType };
