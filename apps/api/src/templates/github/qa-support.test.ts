/* Deterministic injected ports retain asynchronous production signatures. */
/* eslint-disable @typescript-eslint/require-await */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { QaTemplateSettingsSchema, JsonValueSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import { qaDigest } from './qa-protocol.js';
import {
  QaSupport,
  unavailableQaIsolation,
  type QaSupportDeps,
  type QaBudgetSnapshot,
} from './qa-support.js';
import {
  QaIdentitySchema,
  QaEnvelopeSchema,
  QaCriteriaSchema,
  QaResultsSchema,
  QaAdversarySchema,
  QaRelativePathSchema,
  QaOutputSchema,
  QaFailure,
  qaScan,
  validateQaCriteria,
  type QaIdentity,
  type QaEnvelope,
  type QaCriteria,
  type QaResults,
  type QaProofSnapshot,
  type QaScope,
} from './qa-protocol.js';
import {
  QaStateSchema,
  SignedQaJournal,
  encodeQaState,
  decodeQaState,
  qaIdentityKey,
  type QaState,
  type QaJournal,
  type QaJournalFiles,
} from './qa-journal.js';
import { DiskQaProofFiles, readQaRegularFile, QA_FILE_BYTES, QA_TOTAL_BYTES } from './qa-proof.js';

const sha = 'a'.repeat(40),
  commit = 'b'.repeat(40),
  credential = 'resolved-private-reader-key';
const identity = QaIdentitySchema.parse({
  ownerId: 'owner',
  runId: fakeUlid('qa-native-double'),
  repository: 'example/repo',
  issue: 7,
  attempt: 1,
  pullRequest: 11,
  mergeSha: sha,
  source: { kind: 'external' },
});
const settings = QaTemplateSettingsSchema.parse({
  kind: 'qa',
  repository: {
    path: join(tmpdir(), 'gg-qa-inert'),
    owner: 'example',
    name: 'repo',
    baseBranch: 'main',
  },
  supportReadKey: 'reader',
  roles: {
    qa: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' },
    adversary: { harness: 'codex', model: 'gpt-6-astra', effort: 'xhigh' },
  },
});
const scope: QaScope = {
  depth: 'standard',
  touchedSystems: ['editor'],
  applicationSystems: ['application'],
};
const originalIssue = {
  number: 7,
  title: 'Preserve authored values',
  body: 'Retain valid values and refuse invalid input.',
};
function criteria(depth: QaScope['depth'] = 'standard'): QaCriteria {
  const sources: { source: 'issue' | 'touched' | 'application'; system: string }[] = [
    { source: 'issue', system: 'acceptance' },
    { source: 'touched', system: 'editor' },
  ];
  if (depth === 'full-regression') sources.push({ source: 'application', system: 'application' });
  return {
    depth,
    touchedSystems: [...scope.touchedSystems],
    applicationSystems: [...scope.applicationSystems],
    criteria: sources.flatMap(({ source, system }) =>
      (['positive', 'negative'] as const).map((polarity) => ({
        id: source + '-' + polarity,
        system,
        source,
        scenario: polarity + ' values',
        polarity,
        steps: ['Exercise ' + polarity],
        expected: polarity === 'positive' ? 'Persists valid values.' : 'Refuses invalid values.',
      })),
    ),
  };
}
function results(input = criteria(), failed = false): QaResults {
  return {
    summary: 'Actual bounded observations',
    results: input.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      status: failed && index === 0 ? 'failed' : 'passed',
      observed: 'Observed ' + criterion.id,
      evidence: [{ path: 'proof.txt', description: 'Captured the observation.' }],
    })),
  };
}
function snapshot(id = identity, rows = results(), input = criteria()): QaProofSnapshot {
  const bytes = Buffer.from('Synthetic proof bytes'),
    hash = createHash('sha256').update(bytes).digest('hex');
  const packet = {
    originalIssue,
    criteria: input,
    results: rows,
    artifacts: [
      {
        id: hash,
        relativePath: 'artifacts/' + hash + '.proof',
        sha256: hash,
        encoding: 'utf8' as const,
        content: bytes.toString(),
      },
    ],
  };
  return { identity: id, packet, digest: qaDigest({ identity: id, packet }) };
}
function envelope(
  nodeId = 'prepare',
  value?: unknown,
  vars: unknown = {},
  id = identity,
  visit = 1,
): QaEnvelope {
  const thread = createInitialThread({
    runId: id.runId,
    loopId: fakeUlid('qa-loop'),
    versionId: fakeUlid('qa-version'),
    invocation: {
      id: fakeUlid('qa-invocation'),
      source: 'manual.api',
      trigger: {
        nodeId: 'start',
        kind: 'manual',
        payload: { attempt: 3, repository: 'forged/repo', mergeSha: 'f'.repeat(40) },
        receivedAt: FIXTURE_TS,
      },
    },
  });
  thread.vars = JsonValueSchema.parse(vars) as QaEnvelope['input']['vars'];
  if (value !== undefined)
    thread.lastOutput = { nodeId: 'model', at: FIXTURE_TS, value: JsonValueSchema.parse(value) };
  return QaEnvelopeSchema.parse({
    settings,
    identity: id,
    nodeId,
    startedSeq: 1,
    visit,
    input: thread,
    claim: { type: 'ClaimRecord', repository: id.repository, issue: id.issue, attempt: id.attempt },
  });
}
class MemoryJournal implements QaJournal {
  states = new Map<string, string>();
  saves = 0;
  async load(id: QaIdentity) {
    const value = this.states.get(qaIdentityKey(id));
    return value === undefined ? undefined : QaStateSchema.parse(JSON.parse(value));
  }
  async save(id: QaIdentity, state: QaState) {
    this.saves++;
    this.states.set(qaIdentityKey(id), JSON.stringify(QaStateSchema.parse(state)));
  }
  async state(id = identity) {
    const value = await this.load(id);
    if (!value) throw new Error('Missing fixture state');
    return value;
  }
}
function fixture(positive = true) {
  const journal = new MemoryJournal(),
    effects: string[] = [],
    remote = { head: null as string | null },
    budgets: QaBudgetSnapshot = { requests: 0, reopenings: 0, attempts: 1 };
  const issue = {
    ...originalIssue,
    state: 'closed' as 'closed' | 'open',
    labels: [] as { name: string }[],
    html_url: 'https://github.com/example/repo/issues/7',
  };
  const pr = {
    number: 11,
    state: 'closed',
    title: 'Change',
    body: 'PR_BODY_CANARY',
    head: { sha, ref: 'feature', repo: { full_name: 'example/repo' } },
    base: { ref: 'main', repo: { full_name: 'example/repo' } },
    draft: false,
    merged: true,
    merge_commit_sha: sha,
  };
  const comments: { body: string }[] = [];
  const deps: QaSupportDeps = {
    github: {
      pullRequest: vi.fn(async () => pr),
      linkedIssues: vi.fn(async () => [{ repository: 'example/repo', number: 7 }]),
      issue: vi.fn(async () => structuredClone(issue)),
      comments: vi.fn(async () => comments),
      post: vi.fn(async (_repo, _issue, body) => {
        effects.push('comment');
        comments.push({ body });
      }),
      label: vi.fn(async (_repo: string, _issue: number, add: readonly string[]) => {
        effects.push('label');
        issue.labels.push(...add.map((name) => ({ name })));
      }),
      reopen: vi.fn(async () => {
        effects.push('reopen');
        issue.state = 'open';
      }),
      mergedCandidates: vi.fn(async () => [{ pullRequest: 11, mergeSha: sha }]),
    },
    repository: {
      prepare: vi.fn(async (_id, round) => {
        effects.push('checkout:' + round);
        return {
          cwd: '/inert/qa',
          artifactRoot: '/inert/artifacts-' + round,
          diff: 'DIFF_CANARY',
          touchedSystems: ['editor'],
          applicationSystems: ['application'],
        };
      }),
      stageProof: vi.fn(async () => {
        effects.push('commit');
        return commit;
      }),
      remoteHead: vi.fn(async () => remote.head),
      containsProof: vi.fn(async (head, expected) => head === expected),
      pushProof: vi.fn(async (_branch, head) => {
        effects.push('push');
        remote.head = head;
        return 'pushed' as const;
      }),
    },
    proofs: {
      collect: vi.fn(async (request) =>
        snapshot(
          request.identity,
          QaResultsSchema.parse(request.results),
          QaCriteriaSchema.parse(request.criteria),
        ),
      ),
      evidence: vi.fn(async (proof, round) => ({
        workspace: '/evidence/' + round,
        packet: proof.packet,
      })),
    },
    journal,
    history: { verify: vi.fn(async () => undefined), budgets: vi.fn(async () => budgets) },
    secrets: [credential],
    ...(positive ? { isolation: { available: vi.fn(async () => true) } } : {}),
  };
  let support = new QaSupport(deps),
    visit = 0;
  const call = async (action: string, value?: unknown, vars: unknown = {}, id = identity) =>
    support.execute(action, envelope(action, value, vars, id, ++visit));
  const prepare = async (id = identity) => {
    await call('prepare', undefined, {}, id);
    await call('criteria-check', criteria(), {}, id);
  };
  const proven = async (failed = false, id = identity) => {
    await prepare(id);
    return call('proof-check', results(criteria(), failed), {}, id);
  };
  const assessed = async (failed = false, sound = true, id = identity) => {
    await proven(failed, id);
    return call(
      'adversary-check',
      undefined,
      {
        adversary: {
          sound,
          summary: 'Evidence inspected',
          gaps: sound
            ? []
            : [{ criterionId: 'issue-negative', message: 'Strengthen negative proof.' }],
        },
      },
      id,
    );
  };
  return {
    deps,
    journal,
    effects,
    remote,
    budgets,
    issue,
    pr,
    comments,
    call,
    prepare,
    proven,
    assessed,
    restart: () => {
      support = new QaSupport(deps);
    },
    execute: (action: string, input: QaEnvelope) => support.execute(action, input),
  };
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'gg-qa-proof-'))
      throw new Error('Fixture cleanup escaped its allocated temporary root.');
    await rm(root, { recursive: true, force: true });
  }
});
async function diskFixture() {
  const root = await mkdtemp(join(tmpdir(), 'gg-qa-proof-'));
  roots.push(root);
  const work = join(root, 'work'),
    evidence = join(root, 'evidence'),
    artifacts = join(work, identity.runId, 'round-0', 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await mkdir(evidence);
  await writeFile(join(artifacts, 'proof.txt'), 'Actual disposable proof bytes');
  const proofs = new DiskQaProofFiles(work, evidence, identity, [credential]);
  const request = {
    identity,
    round: 0,
    artifactRoot: artifacts,
    scope,
    originalIssue,
    criteria: criteria(),
    results: results(),
    secrets: [credential],
  };
  return { root, work, evidence, artifacts, proofs, request };
}

describe('QA strict typed boundaries and complete criteria', () => {
  it('requires issue and touched-system positive/negative proof and broader full regression', () => {
    expect(validateQaCriteria(criteria(), scope)).toEqual(criteria());
    expect(
      validateQaCriteria(criteria('full-regression'), { ...scope, depth: 'full-regression' })
        .criteria,
    ).toHaveLength(6);
    expect(QaOutputSchema.safeParse({ type: 'QaNext', route: 'invented' }).success).toBe(false);
  });
  it.each([
    'missing-issue',
    'missing-touched',
    'missing-application',
    'duplicate-id',
    'duplicate-system',
    'wrong-depth',
    'wrong-system',
    'unlisted-system',
    'empty-application',
  ])('refuses %s coverage', (kind) => {
    const input = criteria(kind.includes('application') ? 'full-regression' : 'standard'),
      expected = { ...scope, depth: input.depth };
    if (kind === 'missing-issue')
      input.criteria = input.criteria.filter((item) => item.source !== 'issue');
    if (kind === 'missing-touched')
      input.criteria = input.criteria.filter((item) => item.id !== 'touched-negative');
    if (kind === 'missing-application')
      input.criteria = input.criteria.filter((item) => item.id !== 'application-negative');
    if (kind === 'duplicate-id') input.criteria[1]!.id = input.criteria[0]!.id;
    if (kind === 'duplicate-system') input.touchedSystems.push('editor');
    if (kind === 'wrong-depth') input.depth = 'full-regression';
    if (kind === 'wrong-system') input.touchedSystems = ['another'];
    if (kind === 'unlisted-system') input.criteria[0]!.source = 'touched';
    if (kind === 'empty-application') {
      input.applicationSystems = [];
      expected.applicationSystems = [];
    }
    expect(() => validateQaCriteria(input, expected)).toThrow();
  });
  it.each([
    '../secret',
    'a/../secret',
    'a//file',
    'a/./file',
    'C:/secret',
    '/secret',
    'NUL.txt',
    'evidence/CON',
    'file.',
    'a\\file',
  ])('rejects nonportable %s artifact path', (path) =>
    expect(QaRelativePathSchema.safeParse(path).success).toBe(false),
  );
  it.each([
    {
      sound: true,
      summary: 'Contradiction',
      gaps: [{ criterionId: null, message: 'Missing proof' }],
    },
    { sound: 'true', summary: 'Claim', gaps: [] },
    { sound: true, summary: 'Claim', gaps: [], decision: 'reopen' },
  ])('refuses malformed adversary authority', (value) =>
    expect(QaAdversarySchema.safeParse(value).success).toBe(false),
  );
  it.each(['repository', 'run', 'claim', 'source'])(
    'refuses a forged %s envelope boundary',
    (kind) => {
      const input = envelope();
      if (kind === 'repository') input.identity.repository = 'other/repo';
      if (kind === 'run') input.input.run.id = fakeUlid('foreign');
      if (kind === 'claim') input.claim!.attempt = 2;
      if (kind === 'source') input.identity.attempt = 2;
      expect(QaEnvelopeSchema.safeParse(input).success).toBe(false);
    },
  );
  it('scans bounded structured/plain output without printing private content', () => {
    expect(() => qaScan({ token: credential }, [credential])).toThrow('QA_SECRET_REFUSED');
    expect(() => qaScan('x'.repeat(4 * 1048576 + 1), [])).toThrow('QA_OUTPUT_BOUND');
    expect(() => qaScan({ safe: true }, ['', credential])).not.toThrow();
  });
});

describe('QA HMAC journal with owner/run/merge domain separation', () => {
  const state = () => QaStateSchema.parse({ identity });
  it('roundtrips current state, refuses tampering and unsigned/cross-domain JSON', () => {
    const text = encodeQaState(identity, state(), credential);
    expect(decodeQaState(identity, text, credential)).toEqual(state());
    const signed = JSON.parse(text) as { payload: string; mac: string; domain: string };
    signed.payload = signed.payload.replace('example/repo', 'foreign/repo');
    expect(() => decodeQaState(identity, JSON.stringify(signed), credential)).toThrow(
      'QA_JOURNAL_AUTHENTICATION',
    );
    expect(() => decodeQaState(identity, JSON.stringify(state()), credential)).toThrow();
    signed.domain = 'graphgoblin.implementation-journal.v1';
    expect(() => decodeQaState(identity, JSON.stringify(signed), credential)).toThrow();
  });
  it.each(['owner', 'run', 'sha'])('refuses a different %s identity on read/write', (kind) => {
    const foreign = {
      ...identity,
      ...(kind === 'owner'
        ? { ownerId: 'other' }
        : kind === 'run'
          ? { runId: fakeUlid('other') }
          : { mergeSha: 'f'.repeat(40) }),
    };
    expect(() =>
      decodeQaState(foreign, encodeQaState(identity, state(), credential), credential),
    ).toThrow('QA_JOURNAL_IDENTITY');
    expect(() => encodeQaState(foreign, state(), credential)).toThrow('QA_JOURNAL_IDENTITY');
  });
  it('refuses empty credentials, oversized state and resolved secrets', () => {
    expect(() => encodeQaState(identity, state(), '')).toThrow('QA_JOURNAL_CREDENTIAL');
    expect(() => decodeQaState(identity, ' ', '')).toThrow('QA_JOURNAL_BOUND');
    expect(() => decodeQaState(identity, 'x'.repeat(1048577), credential)).toThrow(
      'QA_JOURNAL_BOUND',
    );
    const secret = state();
    secret.report = { key: credential, started: false, complete: false };
    expect(() => encodeQaState(identity, secret, credential)).toThrow('QA_SECRET_REFUSED');
    const oversized = state();
    oversized.report = { key: 'x'.repeat(1048577), started: false, complete: false };
    expect(() => encodeQaState(identity, oversized, credential)).toThrow('QA_JOURNAL_BOUND');
  });
  it('uses bounded shared text primitives and reloads signed state after restart', async () => {
    const texts = new Map<string, string>();
    const files: QaJournalFiles = {
      canonical: async (path) => resolve(path),
      read: async (path) => texts.get(path),
      text: async (_root, path, text) => {
        texts.set(path, text);
      },
    };
    const root = join(tmpdir(), 'inert-journal'),
      first = new SignedQaJournal(files, root, credential);
    expect(await first.load(identity)).toBeUndefined();
    await first.save(identity, state());
    expect(await new SignedQaJournal(files, root, credential).load(identity)).toEqual(state());
    expect([...texts.keys()][0]).toBe(join(resolve(root), qaIdentityKey(identity) + '.qa.json'));
  });
});

describe('Real bounded filesystem proof checks; disposable files, no Git/native process', () => {
  it('hashes bytes and creates/reuses a support-owned packet without repository/PR context', async () => {
    const f = await diskFixture(),
      proof = await f.proofs.collect(f.request),
      artifact = proof.packet.artifacts[0]!;
    expect(artifact.sha256).toBe(
      createHash('sha256').update('Actual disposable proof bytes').digest('hex'),
    );
    expect(proof.packet.results.results[0]!.evidence[0]!.path).toBe(artifact.relativePath);
    const child = await f.proofs.evidence(proof, 0);
    expect(await readFile(join(child.workspace, artifact.relativePath), 'utf8')).toBe(
      artifact.content,
    );
    expect(await f.proofs.evidence(proof, 0)).toEqual(child);
    expect(JSON.stringify(child.packet)).not.toMatch(
      /PR_BODY_CANARY|DIFF_CANARY|templateSettings|credential/,
    );
    expect((await f.proofs.evidence(proof, 1)).workspace).not.toBe(child.workspace);
  });
  it('copies binary bytes and recomputes hashes before any copy', async () => {
    const f = await diskFixture(),
      bytes = Buffer.from([0, 255, 254, 1]);
    await writeFile(join(f.artifacts, 'proof.txt'), bytes);
    const proof = await f.proofs.collect(f.request);
    expect(proof.packet.artifacts[0]!.encoding).toBe('base64');
    const evidence = await f.proofs.evidence(proof, 0);
    expect(
      await readFile(join(evidence.workspace, proof.packet.artifacts[0]!.relativePath)),
    ).toEqual(bytes);
    proof.packet.artifacts[0]!.sha256 = '0'.repeat(64);
    proof.digest = qaDigest({ identity, packet: proof.packet });
    await expect(f.proofs.evidence(proof, 1)).rejects.toThrow('QA_PROOF_IDENTITY');
  });
  it.each(['run', 'sha', 'issue', 'round', 'root'])(
    'refuses stale/outside %s proof identity',
    async (kind) => {
      const f = await diskFixture();
      if (kind === 'run') f.request.identity = { ...identity, runId: fakeUlid('old') };
      if (kind === 'sha') f.request.identity = { ...identity, mergeSha: 'f'.repeat(40) };
      if (kind === 'issue') f.request.originalIssue = { ...originalIssue, number: 8 };
      if (kind === 'round') f.request.round = 2;
      if (kind === 'root') f.request.artifactRoot = f.evidence;
      await expect(f.proofs.collect(f.request)).rejects.toThrow();
    },
  );
  it.each([
    'missing',
    'empty',
    'oversized',
    'directory',
    'hardlink',
    'secret',
    'structured-secret',
    'duplicate',
    'omitted',
    'foreign-criterion',
  ])('refuses %s evidence', async (kind) => {
    const f = await diskFixture();
    if (kind === 'missing') f.request.results.results[0]!.evidence[0]!.path = 'missing.txt';
    if (kind === 'empty') await writeFile(join(f.artifacts, 'proof.txt'), '');
    if (kind === 'oversized')
      await writeFile(join(f.artifacts, 'proof.txt'), Buffer.alloc(QA_FILE_BYTES + 1));
    if (kind === 'directory') {
      await mkdir(join(f.artifacts, 'directory'));
      f.request.results.results[0]!.evidence[0]!.path = 'directory';
    }
    if (kind === 'hardlink')
      await link(join(f.artifacts, 'proof.txt'), join(f.root, 'outside-proof'));
    if (kind === 'secret') await writeFile(join(f.artifacts, 'proof.txt'), credential);
    if (kind === 'structured-secret') f.request.results.summary = credential;
    if (kind === 'duplicate')
      f.request.results.results[1]!.criterionId = f.request.results.results[0]!.criterionId;
    if (kind === 'omitted') f.request.results.results.pop();
    if (kind === 'foreign-criterion') f.request.results.results[0]!.criterionId = 'unknown';
    await expect(f.proofs.collect(f.request)).rejects.toThrow();
  });
  it('rejects aggregate overflow', async () => {
    const f = await diskFixture();
    for (let index = 0; index < 3; index++) {
      await writeFile(join(f.artifacts, 'proof-' + index), Buffer.alloc(QA_TOTAL_BYTES / 2, 1));
      f.request.results.results[index]!.evidence[0]!.path = 'proof-' + index;
    }
    await expect(f.proofs.collect(f.request)).rejects.toThrow('QA_PROOF_BOUND');
  });
  it('refuses link/junction ancestors without reading outside bytes', async () => {
    const f = await diskFixture();
    await symlink(
      f.evidence,
      join(f.artifacts, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await writeFile(join(f.evidence, 'outside.txt'), 'outside');
    f.request.results.results[0]!.evidence[0]!.path = 'linked/outside.txt';
    await expect(f.proofs.collect(f.request)).rejects.toThrow('QA_PATH_LINK');
  });
  it.each([
    'digest',
    'foreign',
    'round',
    'path',
    'hash',
    'extra-file',
    'changed-file',
    'overlapping-root',
  ])('refuses %s evidence-copy corruption', async (kind) => {
    const f = await diskFixture(),
      proof = await f.proofs.collect(f.request);
    let round = 0;
    if (kind === 'digest') proof.digest = '0'.repeat(64);
    if (kind === 'foreign') {
      proof.identity = { ...identity, ownerId: 'other' };
      proof.digest = qaDigest({ identity: proof.identity, packet: proof.packet });
    }
    if (kind === 'round') round = 2;
    if (kind === 'path') {
      proof.packet.artifacts[0]!.relativePath = 'issue.json';
      proof.digest = qaDigest({ identity, packet: proof.packet });
    }
    if (kind === 'hash') {
      proof.packet.artifacts[0]!.sha256 = '0'.repeat(64);
      proof.digest = qaDigest({ identity, packet: proof.packet });
    }
    if (kind === 'extra-file' || kind === 'changed-file') {
      const copy = await f.proofs.evidence(proof, 0);
      await writeFile(
        join(copy.workspace, kind === 'extra-file' ? 'extra' : 'issue.json'),
        'tampered',
      );
    }
    await expect(
      (kind === 'overlapping-root'
        ? new DiskQaProofFiles(f.work, f.work, identity)
        : f.proofs
      ).evidence(proof, round),
    ).rejects.toThrow();
  });
  it('bounds direct reads and rejects root/outside/invalid bounds', async () => {
    const f = await diskFixture();
    expect(
      (await readQaRegularFile(f.artifacts, join(f.artifacts, 'proof.txt'))).length,
    ).toBeGreaterThan(0);
    for (const [root, path, max] of [
      [f.artifacts, f.artifacts, 20],
      [f.artifacts, join(f.root, 'outside'), 20],
      [f.artifacts, join(f.artifacts, 'proof.txt'), 0],
      [f.artifacts, join(f.artifacts, 'proof.txt'), 1048577],
    ] as const)
      await expect(readQaRegularFile(root, path, max)).rejects.toThrow('QA_PATH_OUTSIDE');
  });
});

describe('QA finite controller over injected positive doubles, never native isolation evidence', () => {
  it('requires a dedicated proof branch distinct from base/source before checkout', async () => {
    const f = fixture(),
      base = envelope(),
      source = envelope();
    base.settings.proofBranch = 'main';
    source.settings.proofBranch = 'feature';
    expect(await f.execute('prepare', base)).toMatchObject({ code: 'QA_INVALID_INPUT' });
    expect(await f.execute('prepare', source)).toMatchObject({ code: 'QA_PROOF_BRANCH_REFUSED' });
    expect(f.effects).toEqual([]);
  });
  it('reports only bounded safe codes and never a credential-shaped provider diagnostic', async () => {
    const f = fixture();
    vi.mocked(f.deps.history.verify).mockRejectedValue(new QaFailure(credential));
    expect(await f.call('prepare')).toMatchObject({ code: 'QA_INVALID_INPUT' });
    f.deps.secrets = ['TOP_SECRET_TOKEN'];
    vi.mocked(f.deps.history.verify).mockRejectedValue(new QaFailure('TOP_SECRET_TOKEN'));
    await expect(f.call('claim')).rejects.toThrow('QA_INVALID_INPUT');
  });
  it('refuses a conflicting known attempt/request history without minting another ordinal', async () => {
    const f = fixture();
    await f.assessed(true);
    f.budgets.attempts = 2;
    expect(await f.call('rework-status')).toMatchObject({ eligible: false });
    await expect(f.call('qa-rework')).rejects.toThrow('QA_REWORK_EXHAUSTED');
    expect(f.effects).not.toContain('reopen');
  });
  it('preserves checked prepare/criteria for an original visit and refuses a second round without rerun', async () => {
    const f = fixture(),
      prepare = envelope('prepare', undefined, {}, identity, 100),
      check = envelope('criteria-check', criteria(), {}, identity, 101);
    expect(await f.execute('prepare', prepare)).toMatchObject({ type: 'QaWorkspace' });
    expect(await f.execute('criteria-check', check)).toMatchObject({ type: 'QaCriteria' });
    f.restart();
    check.input.lastOutput!.value = { fabricated: true };
    expect(await f.execute('prepare', prepare)).toMatchObject({ type: 'QaWorkspace' });
    expect(await f.execute('criteria-check', check)).toMatchObject({
      type: 'QaCriteria',
      value: criteria(),
    });
    expect(await f.call('prepare')).toMatchObject({ code: 'QA_PREPARE_CONSUMED' });
    expect(await f.call('criteria-check', criteria())).toMatchObject({
      code: 'QA_CRITERIA_CONSUMED',
    });
    expect(f.effects).toEqual(['checkout:0']);
  });
  it('default unavailable capability refuses before every port effect including claim/poll', async () => {
    const f = fixture(false);
    expect(await unavailableQaIsolation.available(null, 'arbitrary')).toBe(false);
    await expect(new QaSupport(f.deps).poll(settings)).rejects.toThrow(
      'TEMPLATE_ISOLATION_UNAVAILABLE',
    );
    for (const action of ['claim', 'qa-rework', 'issue-reopened', 'qa-outcome'])
      await expect(f.call(action)).rejects.toThrow('TEMPLATE_ISOLATION_UNAVAILABLE');
    for (const action of [
      'prepare',
      'criteria-check',
      'proof-check',
      'evidence-prepare',
      'adversary-check',
      'rework-status',
      'rerun-prepare',
      'human',
      'relabel',
    ])
      expect(await f.call(action)).toMatchObject({
        type: 'SupportBlocked',
        code: 'TEMPLATE_ISOLATION_UNAVAILABLE',
      });
    expect(await f.call('prerequisites')).toMatchObject({
      type: 'QaPrerequisites',
      available: false,
    });
    expect(await f.call('block')).toMatchObject({ type: 'QaBlocked' });
    expect(f.effects).toEqual([]);
    expect(f.journal.saves).toBe(0);
    expect(f.deps.history.verify).not.toHaveBeenCalled();
  });
  it('permits authentic external lineage without forged PrCreated and ignores selector authority', async () => {
    const f = fixture();
    expect(await f.call('claim')).toEqual({
      type: 'ClaimRecord',
      repository: 'example/repo',
      issue: 7,
      attempt: 1,
    });
    expect(await f.call('prerequisites')).toMatchObject({ available: true });
    expect(await f.assessed()).toEqual({ type: 'QaNext', route: 'passed' });
    expect(await f.call('evidence-prepare')).toMatchObject({ type: 'QaEvidence' });
    expect(await f.call('qa-outcome', undefined, { outcome: 'passed' })).toMatchObject({
      type: 'QaOutcome',
      mergeSha: sha,
      outcome: 'passed',
    });
    expect(f.effects).toEqual(['checkout:0', 'commit', 'push']);
    expect((await f.journal.state()).proof).toMatchObject({ pushes: 1, published: true });
  });
  it.each([
    'missing-link',
    'ambiguous-link',
    'foreign-link',
    'foreign-pr',
    'stale-merge',
    'unmerged',
    'draft',
    'wrong-issue',
    'foreign-issue',
    'pr-as-issue',
    'history',
  ])('rejects %s before checkout', async (kind) => {
    const f = fixture();
    if (kind === 'missing-link') vi.mocked(f.deps.github.linkedIssues).mockResolvedValue([]);
    if (kind === 'ambiguous-link')
      vi.mocked(f.deps.github.linkedIssues).mockResolvedValue([
        { repository: 'example/repo', number: 7 },
        { repository: 'example/repo', number: 8 },
      ]);
    if (kind === 'foreign-link')
      vi.mocked(f.deps.github.linkedIssues).mockResolvedValue([
        { repository: 'foreign/repo', number: 7 },
      ]);
    if (kind === 'foreign-pr') f.pr.base.repo.full_name = 'foreign/repo';
    if (kind === 'stale-merge') f.pr.merge_commit_sha = 'f'.repeat(40);
    if (kind === 'unmerged') f.pr.merged = false;
    if (kind === 'draft') f.pr.draft = true;
    if (kind === 'wrong-issue') f.issue.number = 8;
    if (kind === 'foreign-issue') f.issue.html_url = 'https://github.com/foreign/repo/issues/7';
    if (kind === 'pr-as-issue')
      vi.mocked(f.deps.github.issue).mockResolvedValue({ ...f.issue, pull_request: {} });
    if (kind === 'history')
      vi.mocked(f.deps.history.verify).mockRejectedValue(new QaFailure('QA_HISTORY_REFUSED'));
    expect(await f.call('prepare')).toMatchObject({ type: 'SupportBlocked' });
    expect(f.effects).toEqual([]);
  });
  it('persists current label depth override and refuses secret-bearing workspace before inference', async () => {
    const f = fixture();
    f.issue.labels.push({ name: 'full-qa' });
    const input = envelope();
    input.settings.fullRegressionLabel = 'full-qa';
    expect(await f.execute('prepare', input)).toMatchObject({ depth: 'full-regression' });
    const second = fixture();
    vi.mocked(second.deps.repository.prepare).mockResolvedValue({
      cwd: '/inert',
      artifactRoot: '/inert/artifacts',
      diff: credential,
      touchedSystems: ['editor'],
      applicationSystems: [],
    });
    expect(await second.call('prepare')).toMatchObject({ code: 'QA_SECRET_REFUSED' });
  });
  it.each([
    'prepare',
    'criteria',
    'proof',
    'rerun',
    'rework',
    'reopen',
    'relabel',
    'outcome',
    'poll',
  ])('refuses out-of-order %s authority', async (kind) => {
    const f = fixture();
    if (kind === 'prepare') {
      const input = envelope();
      input.claim = null;
      expect(await f.execute('prepare', input)).toMatchObject({ code: 'QA_CLAIM_REQUIRED' });
      return;
    }
    const action = {
      criteria: 'criteria-check',
      proof: 'proof-check',
      rerun: 'rerun-prepare',
      rework: 'qa-rework',
      reopen: 'issue-reopened',
      relabel: 'relabel',
      outcome: 'qa-outcome',
      poll: 'poll',
    }[kind]!;
    if (['qa-rework', 'issue-reopened', 'qa-outcome'].includes(action))
      await expect(f.call(action)).rejects.toBeInstanceOf(QaFailure);
    else expect(await f.call(action)).toMatchObject({ type: 'SupportBlocked' });
    expect(f.effects).toEqual([]);
  });
  it('rejects malformed envelopes/actions and wrong signed journal identity', async () => {
    const f = fixture();
    expect(await f.execute('unknown', envelope())).toMatchObject({ code: 'QA_INVALID_INPUT' });
    const wrong = envelope();
    wrong.input.run.id = fakeUlid('other');
    expect(await f.execute('prepare', wrong)).toMatchObject({ code: 'QA_INVALID_INPUT' });
    vi.spyOn(f.journal, 'load').mockResolvedValue(
      QaStateSchema.parse({ identity: { ...identity, ownerId: 'other' } }),
    );
    expect(await f.call('prepare')).toMatchObject({ code: 'QA_JOURNAL_IDENTITY' });
  });
  it('rechecks capability immediately before checkout after earlier success', async () => {
    const f = fixture();
    vi.mocked(f.deps.isolation!.available).mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await f.call('prepare')).toMatchObject({ code: 'TEMPLATE_ISOLATION_UNAVAILABLE' });
    expect(f.effects).toEqual([]);
  });
  it('strictly binds returned snapshot to admitted run and merge', async () => {
    const f = fixture();
    await f.prepare();
    vi.mocked(f.deps.proofs.collect).mockResolvedValue(
      snapshot({ ...identity, mergeSha: 'f'.repeat(40) }),
    );
    expect(await f.call('proof-check', results())).toMatchObject({ code: 'QA_PROOF_IDENTITY' });
    expect(f.effects).toEqual(['checkout:0']);
  });
  it('caches original visits across restart without repeated push and rejects forged outcome', async () => {
    const f = fixture();
    await f.prepare();
    const input = envelope('proof-check', results(), {}, identity, 100),
      first = await f.execute('proof-check', input);
    f.restart();
    expect(await f.execute('proof-check', input)).toEqual(first);
    expect(f.effects.filter((value) => value === 'push')).toHaveLength(1);
    await expect(f.call('qa-outcome', undefined, { outcome: 'passed' })).rejects.toThrow(
      'QA_OUTCOME_AUTHORITY',
    );
  });
  it.each([0, 1, 3])('bounds nonforce proof attempts at %s', async (limit) => {
    const f = fixture();
    await f.prepare();
    vi.mocked(f.deps.repository.pushProof).mockResolvedValue('conflict');
    const input = envelope('proof-check', results());
    input.settings.limits.proofPushRetries = limit;
    expect(await f.execute('proof-check', input)).toMatchObject({ code: 'QA_PUSH_EXHAUSTED' });
    expect(f.effects.filter((value) => value === 'commit')).toHaveLength(limit);
    expect(f.deps.repository.pushProof).toHaveBeenCalledTimes(limit);
    expect((await f.journal.state()).proof!.pushes).toBe(limit);
  });
  it('reconciles response-lost successful push without repeating it', async () => {
    const f = fixture();
    await f.prepare();
    vi.mocked(f.deps.repository.pushProof).mockImplementationOnce(async (_branch, head) => {
      f.remote.head = head;
      f.effects.push('push');
      throw new Error('Private subprocess diagnostic');
    });
    const input = envelope('proof-check', results(), {}, identity, 100);
    expect(await f.execute('proof-check', input)).toMatchObject({ code: 'QA_INVALID_INPUT' });
    f.restart();
    expect(await f.execute('proof-check', input)).toMatchObject({
      type: 'QaProof',
      proofCommit: commit,
    });
    expect(f.effects.filter((value) => value === 'push')).toHaveLength(1);
  });
  it.each(['absent', 'wrong-remote', 'wrong-contains'])(
    'refuses uncertain %s push without retry/cleanup',
    async (kind) => {
      const f = fixture();
      await f.prepare();
      if (kind === 'absent')
        vi.mocked(f.deps.repository.pushProof).mockRejectedValue(new Error('lost response'));
      if (kind === 'wrong-remote')
        vi.mocked(f.deps.repository.pushProof).mockImplementation(async () => {
          f.remote.head = 'f'.repeat(40);
          return 'pushed';
        });
      if (kind === 'wrong-contains')
        vi.mocked(f.deps.repository.containsProof).mockResolvedValue(false);
      const input = envelope('proof-check', results(), {}, identity, 100);
      expect(await f.execute('proof-check', input)).toMatchObject({ type: 'SupportBlocked' });
      f.restart();
      expect(await f.execute('proof-check', input)).toMatchObject({ code: 'QA_PUSH_UNCERTAIN' });
      expect(f.deps.repository.pushProof).toHaveBeenCalledTimes(1);
    },
  );
  it('reconciles one conflict before publishing on the observed branch parent', async () => {
    const f = fixture();
    await f.prepare();
    vi.mocked(f.deps.repository.pushProof).mockResolvedValueOnce('conflict');
    expect(await f.call('proof-check', results())).toMatchObject({ type: 'QaProof' });
    expect(f.deps.repository.stageProof).toHaveBeenCalledTimes(2);
    expect((await f.journal.state()).proof!.pushes).toBe(2);
  });
  it.each([0, 1])('permits at most %s unsound reruns then human reconciliation', async (limit) => {
    const f = fixture();
    await f.assessed(false, false);
    const input = envelope('adversary-check', undefined, {
      adversary: {
        sound: false,
        summary: 'Gap',
        gaps: [{ criterionId: null, message: 'More evidence.' }],
      },
    });
    input.settings.limits.unsoundReruns = limit;
    expect(await f.execute('adversary-check', input)).toMatchObject({
      route: limit ? 'rerun' : 'human',
    });
    if (limit) {
      expect(await f.call('rerun-prepare')).toMatchObject({ type: 'QaRerun' });
      await f.assessed(false, false);
      expect(await f.call('rerun-prepare')).toMatchObject({ code: 'QA_RERUN_EXHAUSTED' });
      expect(f.effects).toContain('checkout:1');
    }
    expect(await f.call('human')).toMatchObject({ type: 'QaHumanRequired' });
    expect(f.effects).not.toContain('reopen');
    expect(f.effects).not.toContain('label');
    expect(f.comments[0]!.body).not.toContain('More evidence.');
  });
  it('rejects contradictory and unknown-criterion adversary results', async () => {
    const f = fixture();
    await f.proven();
    expect(
      await f.call('adversary-check', undefined, {
        adversary: { sound: true, summary: 'Claim', gaps: [{ criterionId: null, message: 'Gap' }] },
      }),
    ).toMatchObject({ code: 'QA_INVALID_INPUT' });
    expect(
      await f.call('adversary-check', undefined, {
        adversary: {
          sound: false,
          summary: 'Claim',
          gaps: [{ criterionId: 'foreign', message: 'Gap' }],
        },
      }),
    ).toMatchObject({ code: 'QA_ADVERSARY_IDENTITY' });
  });
  it('orders eligibility→request→actual reopen→label→authentic outcome', async () => {
    const f = fixture();
    await f.assessed(true);
    expect(await f.call('rework-status')).toEqual({
      type: 'QaReworkEligibility',
      eligible: true,
      requiresReopen: true,
    });
    expect(await f.call('qa-rework')).toMatchObject({ type: 'ReworkRequest', request: 1 });
    expect(await f.call('issue-reopened')).toMatchObject({ type: 'IssueReopened', request: 1 });
    expect(await f.call('relabel')).toEqual({ type: 'QaRelabeled' });
    expect(await f.call('qa-outcome', undefined, { outcome: 'rework' })).toMatchObject({
      type: 'QaOutcome',
      outcome: 'rework',
    });
    expect(f.effects.slice(-2)).toEqual(['reopen', 'label']);
  });
  it('open issue consumes request without fabricated reopen; attempt2 never resets', async () => {
    const f = fixture(),
      second = QaIdentitySchema.parse({
        ...identity,
        attempt: 2,
        source: { kind: 'implementation', runId: fakeUlid('implementation-2') },
      });
    f.issue.state = 'open';
    f.budgets.requests = 1;
    f.budgets.reopenings = 2;
    f.budgets.attempts = 2;
    await f.assessed(true, true, second);
    expect(await f.call('rework-status', undefined, {}, second)).toMatchObject({
      eligible: true,
      requiresReopen: false,
    });
    expect(await f.call('qa-rework', undefined, {}, second)).toMatchObject({
      attempt: 2,
      request: 2,
    });
    await expect(f.call('issue-reopened', undefined, {}, second)).rejects.toThrow(
      'QA_REOPEN_REQUIRED',
    );
    expect(await f.call('relabel', undefined, {}, second)).toEqual({ type: 'QaRelabeled' });
    expect(f.effects).not.toContain('reopen');
  });
  it.each(['requests', 'reopens', 'attempts', 'third-attempt', 'zero-request', 'zero-reopen'])(
    'never replenishes exhausted %s authority',
    async (kind) => {
      const f = fixture(),
        id =
          kind === 'third-attempt'
            ? QaIdentitySchema.parse({
                ...identity,
                attempt: 3,
                source: { kind: 'implementation', runId: fakeUlid('implementation-3') },
              })
            : identity;
      await f.assessed(true, true, id);
      if (kind === 'requests') f.budgets.requests = 2;
      if (kind === 'reopens') f.budgets.reopenings = 2;
      if (kind === 'attempts') f.budgets.attempts = 3;
      const check = envelope('rework-status', undefined, {}, id, 90),
        request = envelope('qa-rework', undefined, {}, id, 91);
      if (kind === 'zero-request') {
        check.settings.limits.reworkRequests = 0;
        request.settings.limits.reworkRequests = 0;
      }
      if (kind === 'zero-reopen') {
        check.settings.limits.reopenings = 0;
        request.settings.limits.reopenings = 0;
      }
      expect(await f.execute('rework-status', check)).toMatchObject({ eligible: false });
      await expect(f.execute('qa-rework', request)).rejects.toThrow('QA_REWORK_EXHAUSTED');
      expect(f.effects).not.toContain('reopen');
    },
  );
  it('reuses original request after restart and refuses a different mapped visit', async () => {
    const f = fixture();
    await f.assessed(true);
    const request = envelope('qa-rework', undefined, {}, identity, 100),
      first = await f.execute('qa-rework', request);
    f.restart();
    expect(await f.execute('qa-rework', request)).toEqual(first);
    await expect(f.call('qa-rework')).rejects.toThrow('QA_REWORK_CONSUMED');
  });
  it('lost-response reopen requires manual reconciliation, no repeated call/fact', async () => {
    const f = fixture();
    await f.assessed(true);
    await f.call('qa-rework');
    vi.mocked(f.deps.github.reopen).mockImplementationOnce(async () => {
      f.effects.push('reopen');
      f.issue.state = 'open';
      throw new Error('lost response');
    });
    const input = envelope('issue-reopened', undefined, {}, identity, 100);
    await expect(f.execute('issue-reopened', input)).rejects.toThrow('QA_INVALID_INPUT');
    f.restart();
    await expect(f.execute('issue-reopened', input)).rejects.toThrow('QA_REOPEN_UNCERTAIN');
    expect(f.deps.github.reopen).toHaveBeenCalledTimes(1);
  });
  it('refuses external reopen before actuation and incomplete effect response', async () => {
    const f = fixture();
    await f.assessed(true);
    await f.call('qa-rework');
    f.issue.state = 'open';
    await expect(f.call('issue-reopened')).rejects.toThrow('QA_REOPEN_TRANSITION');
    expect(f.deps.github.reopen).not.toHaveBeenCalled();
    const other = fixture();
    await other.assessed(true);
    await other.call('qa-rework');
    vi.mocked(other.deps.github.reopen).mockResolvedValue(undefined);
    await expect(other.call('issue-reopened')).rejects.toThrow('QA_REOPEN_UNCERTAIN');
  });
  it('reconciles response-lost label by actual snapshot without repeating effect', async () => {
    const f = fixture();
    f.issue.state = 'open';
    await f.assessed(true);
    await f.call('qa-rework');
    vi.mocked(f.deps.github.label).mockImplementationOnce(async (_repo, _issue, add) => {
      f.effects.push('label');
      f.issue.labels.push({ name: add[0]! });
      throw new Error('lost response');
    });
    const input = envelope('relabel', undefined, {}, identity, 100);
    expect(await f.execute('relabel', input)).toMatchObject({ type: 'SupportBlocked' });
    f.restart();
    expect(await f.execute('relabel', input)).toEqual({ type: 'QaRelabeled' });
    expect(f.deps.github.label).toHaveBeenCalledTimes(1);
  });
  it('refuses uncertain missing label and recovers comment response loss by fixed marker', async () => {
    const f = fixture();
    f.issue.state = 'open';
    await f.assessed(true);
    await f.call('qa-rework');
    vi.mocked(f.deps.github.label).mockRejectedValue(new Error('lost response'));
    const input = envelope('relabel', undefined, {}, identity, 100);
    await f.execute('relabel', input);
    expect(await f.execute('relabel', input)).toMatchObject({ code: 'QA_LABEL_UNCERTAIN' });
    expect(f.deps.github.label).toHaveBeenCalledTimes(1);
    const human = fixture();
    vi.mocked(human.deps.github.post).mockImplementationOnce(async (_repo, _issue, body) => {
      human.comments.push({ body });
      throw new Error('lost response');
    });
    const request = envelope('human', undefined, {}, identity, 100);
    await human.execute('human', request);
    human.restart();
    expect(await human.execute('human', request)).toMatchObject({ type: 'QaHumanRequired' });
    expect(human.deps.github.post).toHaveBeenCalledTimes(1);
  });
  it.each(['full', 'duplicate', 'uncertain', 'new-visit'])(
    'refuses %s comment report without another post',
    async (kind) => {
      const f = fixture(),
        input = envelope('human', undefined, {}, identity, 100);
      if (kind === 'full')
        for (let index = 0; index < 100; index++) f.comments.push({ body: 'ordinary' });
      if (kind === 'duplicate') {
        await f.execute('human', input);
        f.comments.push(f.comments[0]!);
        const state = await f.journal.state();
        state.results = {};
        state.report!.complete = false;
        await f.journal.save(identity, state);
      }
      if (kind === 'uncertain') {
        vi.mocked(f.deps.github.post).mockRejectedValue(new Error('lost response'));
        await f.execute('human', input);
      }
      if (kind === 'new-visit') {
        await f.execute('human', input);
        input.visit = 101;
      }
      expect(await f.execute('human', input)).toMatchObject({ type: 'SupportBlocked' });
      expect(f.deps.github.post).toHaveBeenCalledTimes(kind === 'full' ? 0 : 1);
    },
  );
  it('polls bounded merge identities and refuses full/duplicate discovery', async () => {
    const f = fixture(),
      support = new QaSupport(f.deps);
    expect(await support.poll(settings)).toEqual({
      items: [{ id: sha, payload: { pullRequest: 11, mergeSha: sha } }],
    });
    vi.mocked(f.deps.github.mergedCandidates).mockResolvedValue([
      { pullRequest: 11, mergeSha: sha },
      { pullRequest: 12, mergeSha: sha },
    ]);
    await expect(support.poll(settings)).rejects.toThrow('QA_DISCOVERY_BOUND');
    vi.mocked(f.deps.github.mergedCandidates).mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        pullRequest: index + 1,
        mergeSha: index.toString(16).padStart(40, '0'),
      })),
    );
    await expect(support.poll(settings)).rejects.toThrow('QA_DISCOVERY_BOUND');
  });
});
