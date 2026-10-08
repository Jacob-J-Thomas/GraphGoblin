import { z } from 'zod';
import {
  NodeOutputSchema,
  RunEventSchema,
  type LoopDefinition,
  type RunEvent,
} from '@graphgoblin/contracts';
import { formatPointer } from '@graphgoblin/domain';
import type { TemplateTransaction } from '@graphgoblin/infrastructure/sqlite';
import type { TemplateBinding } from './binding.js';
import { assertBoundVersion } from './binding.js';
import { TemplateError } from './errors.js';
import type { ParentSubjectSchema } from './subjects.js';
import { parseSubject, sameSubject, type TemplateSubject } from './subjects.js';
const AuthorityFields = {
  repository: z.string(),
  issue: z.number().int().positive(),
  attempt: z.number().int().min(1).max(3),
};
const OptionalLinkFields = {
  repository: z.string(),
  issue: AuthorityFields.issue.nullable(),
  attempt: AuthorityFields.attempt.nullable(),
};
export const ClaimRecordSchema = z.strictObject({
  type: z.literal('ClaimRecord'),
  ...OptionalLinkFields,
});
export const PrCreatedSchema = z.strictObject({
  type: z.literal('PrCreated'),
  ...AuthorityFields,
  pullRequest: z.number().int().positive(),
  head: z.string().regex(/^[a-f0-9]{40}$/),
});
export const QaReworkRequestSchema = z.strictObject({
  type: z.literal('ReworkRequest'),
  ...AuthorityFields,
  pullRequest: z.number().int().positive(),
  mergeSha: z.string().regex(/^[a-f0-9]{40}$/),
  request: z.number().int().min(1).max(2),
});
export const IssueReopenedSchema = z.strictObject({
  type: z.literal('IssueReopened'),
  ...AuthorityFields,
  pullRequest: z.number().int().positive(),
  mergeSha: z.string().regex(/^[a-f0-9]{40}$/),
  request: z.number().int().min(1).max(2),
});
export const FixerHeadSchema = z.strictObject({
  type: z.literal('FixerHead'),
  ...OptionalLinkFields,
  pullRequest: z.number().int().positive(),
  head: z.string().regex(/^[a-f0-9]{40}$/),
});
export const QaOutcomeSchema = z.strictObject({
  type: z.literal('QaOutcome'),
  ...AuthorityFields,
  pullRequest: z.number().int().positive(),
  mergeSha: z.string().regex(/^[a-f0-9]{40}$/),
  outcome: z.enum(['passed', 'blocked', 'rework']),
});
export const AuthorityFactSchema = z.discriminatedUnion('type', [
  ClaimRecordSchema,
  PrCreatedSchema,
  QaReworkRequestSchema,
  IssueReopenedSchema,
  FixerHeadSchema,
  QaOutcomeSchema,
]);
export type AuthorityFact = z.infer<typeof AuthorityFactSchema>;
function conflict(): never {
  throw new TemplateError(
    'AUTHORITY_CONFLICT',
    'The selected subject has corrupt or conflicting authority history.',
  );
}
export function checkedEvents(
  rows: Awaited<ReturnType<TemplateTransaction['events']>>,
): RunEvent[] {
  if (rows.length > 1000) conflict();
  return rows.map((row, index) => {
    const parsed = RunEventSchema.safeParse({
      ...row.payload,
      type: row.type,
      runId: row.runId,
      seq: row.seq,
      ts: row.ts,
      ...(row.nodeId ? { nodeId: row.nodeId } : {}),
    });
    if (!parsed.success || parsed.data.seq !== index + 1) conflict();
    return parsed.data;
  });
}
/** Only output patches from a paired, frozen deterministic packaged-support visit confer authority. */
export function authorityFacts(
  binding: TemplateBinding,
  loopId: string,
  versionId: string,
  definition: LoopDefinition,
  subject: TemplateSubject,
  events: readonly RunEvent[],
): AuthorityFact[] {
  const bound = assertBoundVersion(binding, loopId, versionId, definition);
  const pending = new Map<string, Extract<RunEvent, { type: 'node.started' }>>();
  const facts: AuthorityFact[] = [];
  for (const event of events) {
    if (event.type === 'node.started') {
      pending.set(event.nodeId, event);
      continue;
    }
    if (event.type !== 'node.finished') continue;
    const started = pending.get(event.nodeId);
    pending.delete(event.nodeId);
    const node = definition.nodes.find((item) => item.id === event.nodeId);
    const mapped = bound.nodes[event.nodeId];
    if (
      !binding.support ||
      !started ||
      started.kind !== 'script' ||
      !node ||
      node.kind !== 'script' ||
      mapped?.kind !== 'script' ||
      started.configHash !== mapped.configHash ||
      node.config.command !== 'graphgoblin-template-support'
    )
      continue;
    const actionTypes: Readonly<Record<string, AuthorityFact['type']>> = {
      claim: 'ClaimRecord',
      'pr-created': 'PrCreated',
      'qa-rework': 'ReworkRequest',
      'issue-reopened': 'IssueReopened',
      'fixer-head': 'FixerHead',
      'qa-outcome': 'QaOutcome',
    };
    const expected = actionTypes[node.config.args[0] ?? ''];
    if (!expected) continue;
    const output = event.patch.find(
      (operation) =>
        (operation.op === 'add' || operation.op === 'replace') &&
        operation.path === formatPointer(['outputs', event.nodeId]),
    );
    if (!output || !('value' in output)) conflict();
    const value = NodeOutputSchema.safeParse(output.value);
    if (!value.success || value.data.nodeId !== event.nodeId) conflict();
    const parsed = AuthorityFactSchema.safeParse(value.data.value);
    if (!parsed.success) conflict();
    const fact = parsed.data;
    if (expected !== fact.type) conflict();
    if (
      fact.repository !== subject.repository ||
      fact.issue !== subject.issue ||
      fact.attempt !== subject.attempt
    )
      conflict();
    facts.push(fact);
  }
  return facts;
}
export async function readAuthority(
  store: TemplateTransaction,
  binding: TemplateBinding,
  runId: string,
) {
  const row = await store.run(runId);
  if (!row || row.run.ownerId !== binding.ownerId || !row.subject) conflict();
  const subject = parseSubject(row.subject);
  if (
    subject.instanceId !== binding.instanceId ||
    subject.templateVersion !== binding.manifest.version ||
    (subject.role === 'parent' &&
      subject.kind === 'implementation' &&
      (subject.source.kind !== 'implementation' || subject.source.runId !== row.run.id))
  )
    conflict();
  const version = await store.version(row.run.versionId);
  if (!version) conflict();
  const events = checkedEvents(await store.events(runId));
  assertPinnedBundle(binding, row.run.loopId, events);
  return {
    run: row.run,
    subject,
    events,
    facts: authorityFacts(
      binding,
      row.run.loopId,
      row.run.versionId,
      version.definition,
      subject,
      events,
    ),
  };
}
export function assertClaim(facts: readonly AuthorityFact[], subject: TemplateSubject): void {
  const claims = facts.filter((fact) => fact.type === 'ClaimRecord');
  if (
    claims.length !== 1 ||
    claims[0]?.repository !== subject.repository ||
    claims[0]?.issue !== subject.issue ||
    claims[0]?.attempt !== subject.attempt
  )
    conflict();
}
export async function nextAttempt(
  store: TemplateTransaction,
  binding: TemplateBinding,
  candidate: Pick<z.infer<typeof ParentSubjectSchema>, 'repository' | 'issue'>,
): Promise<number> {
  const rows = await store.subjectRuns({
    ownerId: binding.ownerId,
    repository: candidate.repository,
    ...(candidate.issue === null ? {} : { issue: candidate.issue }),
    limit: 65,
  });
  if (rows.length > 64) conflict();
  let current = 0;
  const requests: Extract<AuthorityFact, { type: 'ReworkRequest' }>[] = [];
  const reopens: Extract<AuthorityFact, { type: 'IssueReopened' }>[] = [];
  const prs: Extract<AuthorityFact, { type: 'PrCreated' }>[] = [];
  const external = new Set<string>();
  let hasImplementationBaseline = false;
  for (const row of rows) {
    if (!row.subject) conflict();
    const subject = parseSubject(row.subject);
    if (subject.role !== 'parent') continue;
    if (subject.issue === null || subject.attempt === null) continue;
    current = Math.max(current, subject.attempt);
    hasImplementationBaseline ||= subject.kind === 'implementation' && subject.attempt === 1;
    const stored = await store.bindingForLoop(binding.ownerId, row.run.loopId);
    if (!stored) conflict();
    const sourceBinding = (await import('./binding.js')).TemplateBindingSchema.parse(
      stored.binding,
    );
    const authority = await readAuthority(store, sourceBinding, row.run.id);
    for (const fact of authority.facts) {
      if (fact.type === 'PrCreated') {
        if (subject.kind !== 'implementation') conflict();
        prs.push(fact);
      }
      if (fact.type === 'IssueReopened') {
        if (
          subject.kind !== 'qa' ||
          fact.pullRequest !== subject.pullRequest ||
          fact.mergeSha !== subject.mergeSha
        )
          conflict();
        reopens.push(fact);
      }
      if (fact.type === 'ReworkRequest') {
        if (
          subject.kind !== 'qa' ||
          !sameSubject(subject, {
            ...subject,
            pullRequest: fact.pullRequest,
            mergeSha: fact.mergeSha,
          })
        )
          conflict();
        requests.push(fact);
        if (subject.source.kind === 'implementation')
          await assertSubjectSource(store, sourceBinding, subject);
        if (subject.source.kind === 'external')
          external.add(fact.pullRequest + ':' + fact.mergeSha);
      }
    }
  }
  if (current === 0) return 1;
  const latest = requests.filter((request) => request.attempt === current);
  if (requests.length > 2 || reopens.length > 2 || latest.length > 1) conflict();
  if (latest.length === 0) return current;
  const request = latest[0]!;
  const created = prs.filter((pr) => pr.attempt === current);
  const externalBaseline =
    current === 1 && external.has(request.pullRequest + ':' + request.mergeSha);
  if (
    request.request !== current ||
    current >= 3 ||
    (externalBaseline
      ? hasImplementationBaseline || created.length !== 0
      : created.length !== 1 || created[0]?.pullRequest !== request.pullRequest)
  )
    conflict();
  const reopened = reopens.filter(
    (fact) =>
      fact.attempt === current &&
      fact.request === request.request &&
      fact.pullRequest === request.pullRequest &&
      fact.mergeSha === request.mergeSha,
  );
  if (reopened.length > 1) conflict();
  return current + 1;
}

/** A trusted external original remains distinct from an authenticated template-created PR. */
export async function assertSubjectSource(
  store: TemplateTransaction,
  binding: TemplateBinding,
  candidate: z.infer<typeof ParentSubjectSchema>,
): Promise<void> {
  if (!candidate.pullRequest) conflict();
  const rows = await store.prFactCandidates(
    binding.ownerId,
    candidate.repository,
    candidate.pullRequest,
    65,
  );
  if (rows.length > 64) conflict();
  const created: { fact: Extract<AuthorityFact, { type: 'PrCreated' }>; runId: string }[] = [];
  for (const row of rows) {
    if (!row.subject) continue;
    const subject = parseSubject(row.subject);
    if (subject.role !== 'parent' || subject.kind !== 'implementation') continue;
    const stored = await store.bindingForLoop(binding.ownerId, row.run.loopId);
    if (!stored) conflict();
    const sourceBinding = (await import('./binding.js')).TemplateBindingSchema.parse(
      stored.binding,
    );
    const authority = await readAuthority(store, sourceBinding, row.run.id);
    for (const fact of authority.facts)
      if (fact.type === 'PrCreated' && fact.pullRequest === candidate.pullRequest)
        created.push({ fact, runId: row.run.id });
  }
  if (candidate.source.kind === 'implementation') {
    if (
      created.length !== 1 ||
      created[0]?.runId !== candidate.source.runId ||
      created[0]?.fact.issue !== candidate.issue ||
      created[0]?.fact.attempt !== candidate.attempt
    )
      conflict();
    return;
  }
  if (created.length) conflict();
  if (candidate.issue === null) return;
  const linked = await store.subjectRuns({
    ownerId: binding.ownerId,
    repository: candidate.repository,
    issue: candidate.issue,
    limit: 65,
  });
  if (linked.length > 64) conflict();
  if (
    linked.some(
      (row) =>
        row.subject &&
        parseSubject(row.subject).role === 'parent' &&
        parseSubject(row.subject).kind === 'implementation',
    )
  )
    throw new TemplateError(
      'AUTHORITY_CONFLICT',
      'The external original conflicts with existing implementation history. Reconcile the original issue authority manually.',
    );
}

export function assertPinnedBundle(
  binding: TemplateBinding,
  loopId: string,
  events: readonly RunEvent[],
): void {
  const queued = events.find((event) => event.type === 'run.queued');
  if (!queued || queued.type !== 'run.queued') conflict();
  const root = binding.loops.find((loop) => loop.loopId === loopId);
  if (!root) conflict();
  const expected: Record<string, string> = {};
  function visit(key: string): void {
    const descriptor = binding.manifest.loops.find((loop) => loop.key === key);
    if (!descriptor) conflict();
    for (const dependency of descriptor.dependsOn) {
      const target = binding.loops.find((loop) => loop.key === dependency);
      if (!target) conflict();
      if (expected[target.loopId]) continue;
      expected[target.loopId] = target.versionId;
      visit(dependency);
    }
  }
  visit(root.key);
  const actual = queued.subloopVersions ?? {};
  if (
    Object.keys(actual).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([id, versionId]) => actual[id] !== versionId)
  )
    conflict();
}
