import { describe, expect, it, vi } from 'vitest';
import { ImplementationTemplateSettingsSchema } from '@graphgoblin/contracts';
import { fakeUlid, sampleThread } from '@graphgoblin/contracts/testing';
import { readSupportInput, supportEntry } from './entry.js';
import {
  ImplementationPlanSchema,
  ImplementationPlanEnvelopeSchema,
  PrProposalSchema,
  SupportActionSchema,
  SupportEnvelopeSchema,
  WorkerResultSchema,
  type SupportEnvelope,
} from './protocol.js';

const settings = ImplementationTemplateSettingsSchema.parse({
  kind: 'implementation',
  repository: { path: 'C:/fixture/repo', owner: 'Fixture', name: 'repo', baseBranch: 'main' },
  supportReadKey: 'reader',
  roles: { implementer: { harness: 'codex', model: 'fixture-model', effort: 'high' } },
});
function nodeEnvelope(): SupportEnvelope {
  const input = sampleThread();
  return SupportEnvelopeSchema.parse({
    settings,
    input,
    credential: 'fixture-private-credential',
    visit: 2,
    identity: {
      kind: 'node',
      ownerId: 'local',
      loopId: input.run.loopId,
      versionId: input.run.versionId,
      nodeId: 'prepare',
      runId: input.run.id,
      startedSeq: 5,
    },
    subject: {
      role: 'parent',
      kind: 'implementation',
      instanceId: fakeUlid('instance'),
      templateVersion: '1.0.0',
      repository: 'fixture/repo',
      issue: 42,
      attempt: 1,
      source: { kind: 'implementation', runId: input.run.id },
    },
    claim: { type: 'ClaimRecord', repository: 'fixture/repo', issue: 42, attempt: 1 },
  });
}
function pollEnvelope(): SupportEnvelope {
  const node = nodeEnvelope();
  return SupportEnvelopeSchema.parse({
    ...node,
    input: null,
    subject: null,
    claim: null,
    visit: null,
    identity: {
      kind: 'poll',
      ownerId: 'local',
      loopId: node.identity.loopId,
      versionId: node.identity.versionId,
      nodeId: 'start',
    },
  });
}
const planTask = { id: 'first', title: 'First task', instructions: 'Make one bounded change.' };
const proposal = {
  title: 'Fixture change',
  summary: 'Bounded summary.',
  changes: ['Change'],
  tests: ['Check'],
  risks: ['Known limitation'],
};

describe('private support authority envelope', () => {
  it('keeps an authenticated node snapshot distinct from forged thread data', () => {
    const original = nodeEnvelope();
    if (!original.input) throw new Error('Expected node input.');
    original.input.invocation.trigger.payload = {
      repository: 'evil/repo',
      issue: 999,
      attempt: 3,
      credential: 'forged',
    };
    original.input.vars['subject'] = { repository: 'evil/repo', issue: 999 };
    const parsed = SupportEnvelopeSchema.parse(original);
    expect(parsed.subject).toMatchObject({ repository: 'fixture/repo', issue: 42, attempt: 1 });
    expect(parsed.claim).toMatchObject({ repository: 'fixture/repo', issue: 42, attempt: 1 });
    expect(parsed.credential).toBe('fixture-private-credential');
  });
  it('allows a claimless admitted node only as a factual pre-claim input', () => {
    expect(SupportEnvelopeSchema.parse({ ...nodeEnvelope(), claim: null }).claim).toBeNull();
    expect(SupportEnvelopeSchema.parse(pollEnvelope()).input).toBeNull();
  });
  it.each(['input', 'subject', 'claim'] as const)(
    'refuses poll authority carried in %s',
    (field) => {
      const poll = pollEnvelope();
      expect(
        SupportEnvelopeSchema.safeParse({ ...poll, [field]: nodeEnvelope()[field] }).success,
      ).toBe(false);
    },
  );
  it.each([
    ['missing subject', () => ({ ...nodeEnvelope(), subject: null })],
    ['missing thread', () => ({ ...nodeEnvelope(), input: null })],
    [
      'wrong run',
      () => {
        const envelope = nodeEnvelope();
        return { ...envelope, identity: { ...envelope.identity, runId: fakeUlid('wrong-run') } };
      },
    ],
    [
      'wrong repository',
      () => {
        const envelope = nodeEnvelope();
        return { ...envelope, subject: { ...envelope.subject, repository: 'other/repo' } };
      },
    ],
    [
      'missing issue and attempt',
      () => {
        const envelope = nodeEnvelope();
        return { ...envelope, subject: { ...envelope.subject, issue: null, attempt: null } };
      },
    ],
    [
      'claim issue conflict',
      () => ({
        ...nodeEnvelope(),
        claim: { type: 'ClaimRecord', repository: 'fixture/repo', issue: 99, attempt: 1 },
      }),
    ],
    [
      'claim repository conflict',
      () => ({
        ...nodeEnvelope(),
        claim: { type: 'ClaimRecord', repository: 'other/repo', issue: 42, attempt: 1 },
      }),
    ],
    [
      'claim attempt conflict',
      () => ({
        ...nodeEnvelope(),
        claim: { type: 'ClaimRecord', repository: 'fixture/repo', issue: 42, attempt: 2 },
      }),
    ],
    ['invalid visit', () => ({ ...nodeEnvelope(), visit: 0 })],
    [
      'invalid started sequence',
      () => {
        const envelope = nodeEnvelope();
        return { ...envelope, identity: { ...envelope.identity, startedSeq: 0 } };
      },
    ],
    ['unknown envelope field', () => ({ ...nodeEnvelope(), executable: 'untrusted' })],
    ['credential oversized', () => ({ ...nodeEnvelope(), credential: 'x'.repeat(4097) })],
  ] as const)('refuses malformed private authority: %s', (_label, input) => {
    expect(SupportEnvelopeSchema.safeParse(input()).success).toBe(false);
  });
});

describe('structured implementation proposals', () => {
  it('unwraps only the strict provider object envelope for either plan branch', () => {
    expect(
      ImplementationPlanEnvelopeSchema.parse({
        plan: { mode: 'direct', instructions: '  Bounded task.  ' },
      }),
    ).toEqual({ plan: { mode: 'direct', instructions: 'Bounded task.' } });
    expect(
      ImplementationPlanEnvelopeSchema.parse({
        plan: { mode: 'split', tasks: [planTask, { ...planTask, id: 'second' }] },
      }).plan.mode,
    ).toBe('split');
  });
  it.each([
    {},
    { unknown: { mode: 'direct', instructions: 'Bounded' } },
    { plan: { mode: 'direct', instructions: 'Bounded' }, extra: true },
    { mode: 'direct', instructions: 'Bounded' },
    { plan: null },
    { plan: { mode: 'unknown', instructions: 'Bounded' } },
    { plan: { mode: 'direct', instructions: 'Bounded', tasks: [planTask] } },
    { plan: { mode: 'split', tasks: [planTask, planTask] } },
  ])('refuses missing/extra/bare/ambiguous provider envelopes (case %#)', (input) => {
    expect(ImplementationPlanEnvelopeSchema.safeParse(input).success).toBe(false);
  });
  it('normalizes nonblank direct instructions and accepts a genuine multi-task split', () => {
    expect(
      ImplementationPlanSchema.parse({ mode: 'direct', instructions: '  Bounded task.  ' }),
    ).toEqual({ mode: 'direct', instructions: 'Bounded task.' });
    expect(
      ImplementationPlanSchema.parse({
        mode: 'split',
        tasks: [planTask, { ...planTask, id: 'second' }],
      }).mode,
    ).toBe('split');
  });
  it.each([
    { mode: 'direct', instructions: ' ' },
    { mode: 'direct', instructions: 'Bounded', tasks: [planTask] },
    { mode: 'split', tasks: [planTask] },
    {
      mode: 'split',
      tasks: [planTask, { ...planTask, title: 'Different title with duplicated ID' }],
    },
    {
      mode: 'split',
      tasks: Array.from({ length: 33 }, (_, index) => ({ ...planTask, id: `task-${index}` })),
    },
    { mode: 'split', tasks: [planTask, { ...planTask, id: '../outside' }] },
    {
      mode: 'split',
      tasks: [planTask, { ...planTask, id: 'second', instructions: 'x'.repeat(12001) }],
    },
  ])('refuses ambiguous/oversized/duplicate plans (case %#)', (input) => {
    expect(ImplementationPlanSchema.safeParse(input).success).toBe(false);
  });
  it('accepts only a bounded worker summary and cannot promote model fields to authority', () => {
    expect(WorkerResultSchema.parse({ summary: '  Actual changes and checks.  ' })).toEqual({
      summary: 'Actual changes and checks.',
    });
    expect(
      WorkerResultSchema.safeParse({ summary: 'Completed', head: 'a'.repeat(40), issue: 999 })
        .success,
    ).toBe(false);
    expect(WorkerResultSchema.safeParse({ summary: 'x'.repeat(4001) }).success).toBe(false);
  });
  it.each([
    { ...proposal, title: '-option' },
    { ...proposal, title: ' -option' },
    { ...proposal, title: 'new\nline' },
    { ...proposal, title: 'nul\0title' },
    { ...proposal, summary: ' ' },
    { ...proposal, changes: [] },
    { ...proposal, tests: [] },
    { ...proposal, risks: [] },
    { ...proposal, body: 'Closes #999' },
  ])('refuses unsafe PR proposals (%j)', (input) => {
    expect(PrProposalSchema.safeParse(input).success).toBe(false);
  });
});

describe('packaged support entry input boundary', () => {
  it('answers --version without instantiating effects or reading private input', async () => {
    const factory = vi.fn(() => Promise.reject(new Error('Should not instantiate.')));
    expect(await supportEntry(['--version'], 'untrusted'.repeat(200000), factory)).toMatchObject({
      name: 'graphgoblin-implementation-support',
      version: '1.0.0',
    });
    expect(factory).not.toHaveBeenCalled();
  });
  it('passes a parsed admitted snapshot to one injected executor without copying credentials into the result', async () => {
    const envelope = nodeEnvelope();
    const execute = vi.fn((action: unknown, input: unknown) => {
      expect(SupportActionSchema.parse(action)).toBe('prepare');
      expect(SupportEnvelopeSchema.parse(input)).toEqual(envelope);
      return Promise.resolve({ type: 'FixtureResult', safe: true });
    });
    const factory = vi.fn((selected: SupportEnvelope['settings']) => {
      expect(selected).toEqual(settings);
      return Promise.resolve({ execute });
    });
    const result = await supportEntry(['prepare'], JSON.stringify(envelope), factory);
    expect(result).toEqual({ type: 'FixtureResult', safe: true });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(envelope.credential);
  });
  it.each([
    { args: [], input: '{}' },
    { args: ['prepare', '--injected'], input: '{}' },
    { args: ['prepare'], input: '{malformed' },
    { args: ['prepare'], input: JSON.stringify({ ...nodeEnvelope(), subject: null }) },
    { args: ['prepare'], input: ' '.repeat(1048577) },
    { args: ['prepare'], input: 'é'.repeat(524289) },
  ])(
    'refuses malformed or byte-oversized input before creating native dependencies (case %#)',
    async ({ args, input }) => {
      const factory = vi.fn(() =>
        Promise.resolve({ execute: vi.fn(() => Promise.resolve({ shouldNotRun: true })) }),
      );
      const result = await supportEntry(args, input, factory);
      expect(result).toMatchObject({ type: 'SupportBlocked' });
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it.each(['factory', 'execute'] as const)(
    'sanitizes private %s exceptions into a fixed refusal',
    async (where) => {
      const marker = 'fixture-private-credential';
      const factory = () => {
        if (where === 'factory') return Promise.reject(new Error(marker));
        return Promise.resolve({
          execute: () => Promise.reject(new Error(marker)),
        });
      };
      const result = await supportEntry(['prepare'], JSON.stringify(nodeEnvelope()), factory);
      expect(result).toMatchObject({ type: 'SupportBlocked', code: 'SUPPORT_UNAVAILABLE' });
      expect(JSON.stringify(result)).not.toContain(marker);
    },
  );
  it('reconstructs valid UTF-8 across split Buffer chunks and accepts the exact byte limit', async () => {
    async function* chunks() {
      const unicode = Buffer.from('é');
      yield await Promise.resolve(unicode.subarray(0, 1));
      yield unicode.subarray(1);
      yield 'x'.repeat(1048574);
    }
    const result = await readSupportInput(chunks());
    expect(result.startsWith('é')).toBe(true);
    expect(Buffer.byteLength(result)).toBe(1048576);
    expect(result).not.toContain('�');
  });
  it('stops an oversized stream at the first excess chunk without consuming later input', async () => {
    let consumed = 0;
    async function* chunks() {
      consumed += 1;
      yield await Promise.resolve('é'.repeat(524288));
      consumed += 1;
      yield Buffer.from('x');
      consumed += 1;
      yield 'never consume';
    }
    await expect(readSupportInput(chunks())).rejects.toThrow('Support input bound');
    expect(consumed).toBe(2);
  });
});
