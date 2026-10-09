import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  TemplateSettingsSchemas,
  type JsonValue,
  type RunRecord,
  type RunEvent,
  type TemplateKind,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  createInitialThread,
  RunManager,
  type RunAdmission,
  type ScriptPort,
  type ScriptRunRequest,
} from '@graphgoblin/engine';
import {
  FakeClock,
  FakeHarness,
  InMemorySecrets,
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
} from '@graphgoblin/engine/testing';
import {
  openMemoryDatabase,
  SqliteApiKeys,
  SqliteTemplateInstances,
  SqliteModelCatalog,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteTriggerAdmission,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import { stableHash } from '@graphgoblin/domain';
import { TemplateCatalog } from './catalog.js';
import { TemplatePrerequisites } from './prerequisites.js';
import { TemplateInstances } from './instances.js';
import { TemplateBindingSchema } from './binding.js';
import { TemplateRuntime, templateAdmission, type TemplateAuthoritySource } from './runtime.js';
import { PrivateTemplateScripts } from './scripts.js';
import { authorityFacts, checkedEvents, nextAttempt } from './authority.js';
import { ParentSubjectSchema, parseSubject, subjectJson } from './subjects.js';
import { ReconciledTemplateFailureReporter } from './failures.js';

const handles: DatabaseHandle[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function foundation(kind: TemplateKind = 'implementation', action = 'claim', poll = false) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const root = await mkdtemp(join(tmpdir(), 'gg-template-foundation-'));
  dirs.push(root);
  await mkdir(join(root, 'recipe'));
  const original = await new TemplateCatalog(
    fileURLToPath(new URL('../../templates', import.meta.url)),
    fileURLToPath(new URL('../..', import.meta.url)),
  ).get('starter');
  const bundle = structuredClone(original.bundle);
  delete bundle.manifest.draftFile; // Synthetic repository bindings have no starting-point asset.
  bundle.manifest.id = 'recipe';
  bundle.manifest.kind = kind;
  const roles =
    kind === 'qa'
      ? (['qa', 'adversary'] as const)
      : kind === 'review'
        ? (['reviewer', 'fixer'] as const)
        : (['implementer'] as const);
  bundle.manifest.roles = roles.map((id) => ({ id, label: id, access: 'write' }));
  bundle.manifest.prerequisites = [
    { id: 'role', label: 'Selected role', kind: 'role', role: roles[0], blocking: 'authoring' },
  ];
  bundle.manifest.requiredSecrets = [{ key: 'supportReadKey', scopes: ['runs:read'] }];
  bundle.manifest.supportEntry = 'dist/templates/support/main.js';
  await mkdir(join(root, 'dist', 'templates', 'support'), { recursive: true });
  const manifestLoop = bundle.manifest.loops[0]!;
  manifestLoop.roleNodes = [{ role: roles[0], nodeId: 'assistant' }];
  const definition = bundle.loops['parent']!;
  const support = LoopDefinitionSchema.parse({
    ...definition,
    nodes: [
      {
        id: 'claim',
        label: 'Support',
        kind: 'script',
        config: {
          command: 'graphgoblin-template-support',
          args: [action],
          stdin: 'thread',
          stdout: 'last-output',
        },
      },
    ],
    edges: [],
  }).nodes[0]!;
  definition.nodes.splice(1, 0, support);
  definition.edges[0]!.to.node = 'claim';
  definition.edges.push({
    id: 'support-settings',
    from: { node: 'claim', port: 'out' },
    to: { node: 'settings', port: 'in' },
  });
  if (roles.length > 1) {
    const inference = definition.nodes.find((node) => node.kind === 'inference')!;
    definition.nodes.splice(-1, 0, { ...inference, id: 'second-role', label: 'Second role' });
    manifestLoop.roleNodes.push({ role: roles[1]!, nodeId: 'second-role' });
    definition.edges.find((edge) => edge.from.node === 'assistant')!.to.node = 'second-role';
    definition.edges.push({
      id: 'second-done',
      from: { node: 'second-role', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
  }
  if (poll) {
    const trigger = definition.nodes[0]!;
    definition.nodes[0] = LoopDefinitionSchema.parse({
      ...definition,
      nodes: [
        {
          ...trigger,
          kind: 'trigger',
          config: {
            subtype: 'poll',
            intervalSeconds: 30,
            fireWhen: 'false',
            probe: { kind: 'script', command: 'graphgoblin-template-support', args: [action] },
          },
        },
      ],
    }).nodes[0]!;
  }
  await writeFile(join(root, 'catalog.json'), JSON.stringify(['recipe/manifest.json']));
  await writeFile(join(root, 'recipe', 'manifest.json'), JSON.stringify(bundle.manifest));
  await writeFile(
    join(root, 'recipe', 'loop.json'),
    JSON.stringify({
      format: 'graphgoblin-loop',
      formatVersion: 3,
      exportedAt: FIXTURE_TS,
      loop: definition,
    }),
  );
  await writeFile(
    join(root, 'dist', 'templates', 'support', 'main.js'),
    '/* test-only installed entry; never launched */',
  );
  const clock = new FakeClock();
  let counter = 0;
  const ids = { next: () => fakeUlid('foundation:' + root + ':' + counter++) };
  const catalog = new SqliteModelCatalog(handle.db);
  await catalog.seed();
  const harness = new FakeHarness();
  const apiKeys = new SqliteApiKeys(handle.db, clock, ids);
  const key = await apiKeys.create('local', 'read-only support', ['runs:read']);
  const secrets = new InMemorySecrets({ 'support-key': key.token });
  const requests: ScriptRunRequest[] = [];
  let result = {
    exitCode: 0 as number | null,
    stdout: '{}',
    stderr: '',
    timedOut: false,
    stdoutOverflow: false,
    stderrOverflow: false,
  };
  let thrown = false;
  const raw: ScriptPort = {
    run: (request) => {
      requests.push(request);
      if (thrown) return Promise.reject(new Error('private-' + key.token));
      return Promise.resolve(result);
    },
  };
  const prerequisites = new TemplatePrerequisites({
    catalog,
    harnesses: { codex: harness },
    scripts: raw,
    apiKeys,
    secretsFor: () => secrets,
    supportAvailable: () => Promise.resolve(true),
  });
  const installed = new TemplateCatalog(root, root);
  const instances = new TemplateInstances(
    installed,
    prerequisites,
    new SqliteTemplateInstances(handle.db),
    ids,
    clock,
  );
  const model = (await catalog.list()).find((entry) => entry.harness === 'codex' && entry.enabled)!;
  const settings = TemplateSettingsSchemas[kind].parse({
    kind,
    repository: { path: root, owner: 'Example', name: 'Project', baseBranch: 'main' },
    supportReadKey: 'support-key',
    roles: Object.fromEntries(
      roles.map((id) => [
        id,
        { harness: 'codex', model: model.model, effort: model.defaultEffort },
      ]),
    ),
  });
  const response = await instances.instantiate('local', 'recipe', { settings });
  const stored = await instances.store.get('local', response.instance.id);
  if (!stored) throw new Error('missing fixture binding');
  const binding = TemplateBindingSchema.parse(stored.binding);
  const authority: TemplateAuthoritySource = {
    resolve: () =>
      Promise.resolve(
        kind === 'implementation'
          ? { kind: 'implementation', repository: 'example/project', issue: 7 }
          : {
              kind: kind === 'review' ? 'review' : 'qa',
              repository: 'example/project',
              issue: 7,
              attempt: 1,
              source: { kind: 'external' },
              ...(kind === 'review'
                ? { pullRequest: 12, head: 'a'.repeat(40) }
                : { pullRequest: 12, mergeSha: 'b'.repeat(40) }),
            },
      ),
    recheck: () => Promise.resolve(),
  };
  const runtime = new TemplateRuntime(instances, authority);
  const events = new SqliteEventStore(handle.db, clock);
  const admission = templateAdmission(
    new SqliteTriggerAdmission(handle.db, events, (tx, input, poll) =>
      runtime.afterRunStaged(tx, input, poll),
    ),
    runtime,
  );
  const runs = new SqliteRunRepository(handle.db, (tx, current, changes) =>
    runtime.beforeTransition(tx, current, changes),
  );
  const pinned = await instances.store.version(response.instance.loops[0]!.versionId);
  if (!pinned) throw new Error('missing fixture definition');
  function intent(seed: string, poll = false): RunAdmission {
    const run: RunRecord = {
      id: fakeUlid(root + seed),
      ownerId: 'local',
      loopId: response.instance.parentLoopId,
      versionId: pinned!.id,
      invocationId: fakeUlid('invocation:' + root + seed),
      status: 'queued',
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
    };
    const thread = createInitialThread({
      runId: run.id,
      loopId: run.loopId,
      versionId: run.versionId,
      invocation: {
        id: run.invocationId,
        source: poll ? 'poll' : 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: poll ? 'poll' : 'manual',
          payload: null,
          receivedAt: FIXTURE_TS,
          ...(poll ? { dedupeKey: 'key-' + seed } : {}),
        },
      },
    });
    return {
      run,
      initialThread: thread,
      queued: { type: 'run.queued', initialThread: thread },
      pinnedLoopIds: [run.loopId],
    };
  }
  async function executing(seed = 'run') {
    const input = intent(seed);
    const run = await admission.create(input);
    const started = await events.append(run.id, [
      {
        type: 'node.started',
        nodeId: 'claim',
        kind: 'script',
        attempt: 1,
        configHash: binding.loops[0]!.nodes['claim']!.configHash,
      },
    ]);
    await runs.update(run.id, { status: 'running', currentNodeId: 'claim' });
    return {
      input,
      run,
      request: {
        command: 'graphgoblin-template-support',
        args: [action],
        cwd: root,
        env: {},
        stdin: JSON.stringify(input.initialThread),
        signal: new AbortController().signal,
        executionIdentity: {
          kind: 'node' as const,
          ownerId: 'local',
          loopId: run.loopId,
          versionId: run.versionId,
          nodeId: 'claim',
          runId: run.id,
          startedSeq: started[0]!.seq,
        },
      },
    };
  }
  return {
    handle,
    root,
    binding,
    instances,
    prerequisites,
    runtime,
    authority,
    admission,
    runs,
    events,
    intent,
    executing,
    requests,
    key,
    apiKeys,
    secrets,
    harness,
    catalog,
    pinned,
    scripts: new PrivateTemplateScripts({
      instances,
      raw,
      apiKeys,
      secretsFor: () => secrets,
      environment: { PATH: 'safe', GH_TOKEN: 'unrelated', GG_API_KEY: key.token },
    }),
    setResult: (patch: Partial<typeof result>) => {
      result = { ...result, ...patch };
    },
    throwRaw: () => {
      thrown = true;
    },
  };
}

describe('private support credential boundary', () => {
  it('supplies the sole runs:read key only through stdin and redacts complete/escaped strings before progress recording', async () => {
    const f = await foundation();
    const { request } = await f.executing();
    const fragments = [f.key.token.slice(0, 9), f.key.token.slice(9)];
    const splitRaw =
      '{"note":"' +
      fragments.join('') +
      '","nested":["' +
      f.key.token
        .split('')
        .map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
        .join('') +
      '"]}';
    f.setResult({ stdout: splitRaw, stderr: fragments.join('') });
    const result = await f.scripts.run(request);
    expect(JSON.parse(result.stdout)).toEqual({ note: '[redacted]', nested: ['[redacted]'] });
    expect(result.stderr).toBe('');
    const launched = f.requests[0]!;
    expect(launched.command).toBe(process.execPath);
    expect(launched.args).toEqual([f.binding.support!.path, 'claim']);
    expect(launched.inheritEnv).toBe(false);
    expect(launched.env).toEqual({ PATH: 'safe' });
    expect(JSON.parse(launched.stdin!).credential === f.key.token).toBe(true);
    expect(
      JSON.stringify([f.binding, request.args, request.env, result]).includes(f.key.token),
    ).toBe(false);
    expect(f.harness.started).toHaveLength(0);
  });
  it.each([
    'missing-identity',
    'wrong-owner',
    'wrong-run',
    'wrong-role',
    'wrong-version',
    'wrong-visit',
    'terminal',
    'revoked',
    'broad-key',
    'wrong-key-owner',
    'env-key',
    'stale-entry',
    'malformed-output',
    'overflow',
    'throw',
  ])('refuses %s without exposing credential or raw diagnostics', async (caseName) => {
    const f = await foundation();
    const { request, run } = await f.executing();
    const bad: ScriptRunRequest = { ...request };
    if (caseName === 'missing-identity') delete bad.executionIdentity;
    if (caseName === 'wrong-owner')
      bad.executionIdentity = { ...request.executionIdentity, ownerId: 'other' };
    if (caseName === 'wrong-run')
      bad.executionIdentity = { ...request.executionIdentity, runId: fakeUlid('other') };
    if (caseName === 'wrong-role')
      bad.executionIdentity = { ...request.executionIdentity, nodeId: 'assistant' };
    if (caseName === 'wrong-version')
      bad.executionIdentity = { ...request.executionIdentity, versionId: fakeUlid('other') };
    if (caseName === 'wrong-visit')
      bad.executionIdentity = { ...request.executionIdentity, startedSeq: 999 };
    if (caseName === 'terminal') await f.runs.update(run.id, { status: 'failed' });
    if (caseName === 'revoked') await f.apiKeys.revoke('local', f.key.record.id);
    if (caseName === 'broad-key' || caseName === 'wrong-key-owner') {
      const key = await f.apiKeys.create(
        caseName === 'wrong-key-owner' ? 'other' : 'local',
        'negative',
        caseName === 'broad-key' ? ['runs:read', 'runs:write'] : ['runs:read'],
      );
      f.scripts = new PrivateTemplateScripts({
        instances: f.instances,
        raw: {
          run: () => {
            throw new Error('must not launch');
          },
        },
        apiKeys: f.apiKeys,
        secretsFor: () => new InMemorySecrets({ 'support-key': key.token }),
      });
    }
    if (caseName === 'env-key') bad.env = { GG_KEY: f.key.token };
    if (caseName === 'stale-entry')
      await writeFile(join(f.root, 'dist', 'templates', 'support', 'main.js'), 'changed');
    if (caseName === 'malformed-output') f.setResult({ stdout: f.key.token });
    if (caseName === 'overflow') f.setResult({ stdoutOverflow: true });
    if (caseName === 'throw') f.throwRaw();
    try {
      await f.scripts.run(bad);
      throw new Error('expected refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
      expect(String(error).includes(f.key.token)).toBe(false);
    }
    if (!['malformed-output', 'overflow', 'throw'].includes(caseName))
      expect(f.requests).toHaveLength(0);
  });
  it('passes an ordinary authored script through without private credential resolution', async () => {
    const f = await foundation();
    const result = await f.scripts.run({
      command: 'ordinary',
      args: [],
      cwd: f.root,
      env: {},
      signal: new AbortController().signal,
    });
    expect(result.stdout).toBe('{}');
    expect(f.requests[0]?.stdin).toBeUndefined();
  });
});

describe('actual prerequisite capability and package checks', () => {
  it('prefers available Codex even with Claude first and falls back only to genuinely supported capability efforts', async () => {
    const f = await foundation();
    const starter = (
      await new TemplateCatalog(
        fileURLToPath(new URL('../../templates', import.meta.url)),
        fileURLToPath(new URL('../..', import.meta.url)),
      ).get('starter')
    ).bundle.manifest;
    const codex = (await f.catalog.list()).find(
      (entry) => entry.harness === 'codex' && entry.enabled,
    )!;
    const claude = new FakeHarness([], 'claude');
    claude.preflightResult = {
      ok: true,
      authenticated: true,
      problems: [],
      models: [
        {
          model: 'synthetic',
          efforts: ['low'],
          admission: 'supported',
          reasonCode: null,
          billingStatus: 'account-dependent',
        },
      ],
      supportedPolicies: [
        {
          sandbox: 'read-only',
          approval: 'never',
          permissionMode: 'dontAsk',
          tools: ['Read'],
          authMethod: 'claude.ai',
          billingMode: 'claude.ai-account',
          billingStatus: 'account-dependent',
          boundary: 'builtin-tools',
          network: 'unconfined',
        },
      ],
    };
    const catalog = {
      list: () =>
        Promise.resolve([
          {
            ...codex,
            harness: 'claude',
            model: 'synthetic',
            defaultEffort: 'high' as const,
            efforts: ['low', 'high'] as ('low' | 'high')[],
          },
          codex,
        ]),
    };
    const deps = {
      catalog,
      harnesses: { codex: f.harness, claude },
      scripts: { run: () => Promise.reject(new Error('no subprocess expected')) },
      apiKeys: f.apiKeys,
      secretsFor: () => f.secrets,
      supportAvailable: () => Promise.resolve(true),
    };
    const checks = new TemplatePrerequisites(deps);
    expect(await checks.defaults(starter)).toMatchObject({
      roles: { assistant: { harness: 'codex' } },
    });
    const selected = TemplateSettingsSchemas.starter.parse({
      kind: 'starter',
      roles: { assistant: { harness: 'claude', model: 'synthetic', effort: 'high' } },
    });
    expect(await checks.check('local', starter, selected)).toMatchObject({
      canInstantiate: false,
      canRun: false,
    });
    f.harness.preflightResult.ok = false;
    expect(await checks.defaults(starter)).toMatchObject({
      roles: { assistant: { harness: 'claude', effort: 'low' } },
    });
    claude.preflightResult.models![0]!.admission = 'blocked';
    expect(await checks.defaults(starter)).toBeNull();
    selected.roles.assistant.effort = 'low';
    expect(await checks.check('local', starter, selected)).toMatchObject({ canInstantiate: false });
    claude.preflightResult.models![0]!.admission = 'supported';
    claude.preflightResult.supportedPolicies = [];
    expect(await checks.check('local', starter, selected)).toMatchObject({ canInstantiate: false });
  });
  it('checks canonical repository/origin, gh auth, support key scopes and unavailable isolation with fake array commands', async () => {
    const f = await foundation();
    const manifest = structuredClone(f.binding.manifest);
    manifest.prerequisites = [
      { id: 'repository', label: 'Repository', kind: 'repository', blocking: 'authoring' },
      { id: 'github', label: 'GitHub', kind: 'github', blocking: 'authoring' },
      {
        id: 'secret',
        label: 'Support read key',
        kind: 'secret',
        secretKey: 'supportReadKey',
        blocking: 'authoring',
      },
      { id: 'support', label: 'Support', kind: 'support', blocking: 'authoring' },
      { id: 'isolation', label: 'QA isolation', kind: 'isolation', blocking: 'runtime' },
    ];
    const calls: ScriptRunRequest[] = [];
    let failed = false;
    const scripts: ScriptPort = {
      run: (request) => {
        calls.push(request);
        return Promise.resolve({
          exitCode: failed ? 1 : 0,
          timedOut: false,
          stdoutOverflow: false,
          stderr: 'private-error',
          stdout:
            request.command === 'git'
              ? request.args[0] === 'rev-parse'
                ? f.root
                : 'https://github.com/Example/Project.git'
              : request.args[0] === 'repo'
                ? '{"nameWithOwner":"Example/Project"}'
                : '',
        });
      },
    };
    const checks = new TemplatePrerequisites({
      catalog: f.catalog,
      harnesses: {},
      scripts,
      apiKeys: f.apiKeys,
      secretsFor: () => f.secrets,
      supportAvailable: () => Promise.resolve(true),
    });
    const report = await checks.check('local', manifest, f.binding.settings);
    expect(report).toMatchObject({ canInstantiate: true, canRun: false });
    expect(report.checks.filter((check) => check.status !== 'ok').map((check) => check.id)).toEqual(
      ['isolation'],
    );
    expect(calls.map((request) => [request.command, request.args])).toEqual([
      ['git', ['rev-parse', '--show-toplevel']],
      ['git', ['remote', 'get-url', 'origin']],
      ['gh', ['auth', 'status']],
      ['gh', ['repo', 'view', 'Example/Project', '--json', 'nameWithOwner']],
    ]);
    expect(JSON.stringify(report).includes('private-error')).toBe(false);
    failed = true;
    expect(await checks.check('local', manifest, f.binding.settings)).toMatchObject({
      canInstantiate: false,
    });
    await f.apiKeys.revoke('local', f.key.record.id);
    expect(
      (await checks.check('local', manifest, f.binding.settings)).checks.find(
        (check) => check.id === 'secret',
      )?.status,
    ).toBe('missing');
    expect(await checks.check('local', manifest, {})).toMatchObject({
      canInstantiate: false,
      canRun: false,
    });
    expect(await checks.defaults(manifest)).toBeNull();
  });
  it('accepts only support entries inside actual shipped package paths', async () => {
    const f = await foundation();
    expect((await f.instances.catalog.get('recipe')).support?.path).toBe(f.binding.support!.path);
    const manifest = structuredClone(f.binding.manifest);
    manifest.supportEntry = 'src/unshipped.js';
    await mkdir(join(f.root, 'src'));
    await writeFile(join(f.root, 'src', 'unshipped.js'), 'unused');
    await writeFile(join(f.root, 'recipe', 'manifest.json'), JSON.stringify(manifest));
    await expect(f.instances.catalog.get('recipe')).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
    });
    await expect(f.instances.catalog.get('absent')).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
    });
  });
});

function outputEvents(
  f: Awaited<ReturnType<typeof foundation>>,
  value: JsonValue,
  seed = 'proof',
  patch = true,
): RunEvent[] {
  const runId = fakeUlid(seed);
  return [
    {
      type: 'node.started',
      runId,
      seq: 1,
      ts: FIXTURE_TS,
      nodeId: 'claim',
      kind: 'script',
      attempt: 1,
      configHash: f.binding.loops[0]!.nodes['claim']!.configHash,
    },
    {
      type: 'node.finished',
      runId,
      seq: 2,
      ts: FIXTURE_TS,
      nodeId: 'claim',
      durationMs: 0,
      patch: patch
        ? [{ op: 'add', path: '/outputs/claim', value: { nodeId: 'claim', value, at: FIXTURE_TS } }]
        : [],
    },
  ];
}
describe('trusted authority provenance and lifecycle', () => {
  it('ignores ordinary support output while requiring a paired frozen typed claim from the declared claim action', async () => {
    const f = await foundation();
    const subject = ParentSubjectSchema.parse({
      role: 'parent',
      kind: 'implementation',
      instanceId: f.binding.instanceId,
      templateVersion: '1.0.0',
      repository: 'example/project',
      issue: 7,
      attempt: 1,
      source: { kind: 'implementation', runId: fakeUlid('proof') },
    });
    const claim = { type: 'ClaimRecord', repository: 'example/project', issue: 7, attempt: 1 };
    const ordinary = structuredClone(f.pinned.definition);
    const support = ordinary.nodes.find((node) => node.id === 'claim');
    if (!support || support.kind !== 'script') throw new Error('missing script');
    support.config.args = ['prepare'];
    const binding = structuredClone(f.binding);
    binding.loops[0]!.hash = (await import('./binding.js')).executionHash(ordinary);
    binding.loops[0]!.nodes['claim']!.configHash = stableHash(support.config);
    const events = outputEvents(f, { workspace: 'ready' });
    if (events[0]?.type !== 'node.started') throw new Error('fixture');
    events[0].configHash = stableHash(support.config);
    expect(
      authorityFacts(binding, f.pinned.loopId, f.pinned.id, ordinary, subject, events),
    ).toEqual([]);
    expect(
      authorityFacts(
        f.binding,
        f.pinned.loopId,
        f.pinned.id,
        f.pinned.definition,
        subject,
        outputEvents(f, claim),
      ),
    ).toEqual([claim]);
    const spoof = outputEvents(f, claim);
    if (spoof[0]?.type !== 'node.started') throw new Error('fixture');
    spoof[0].kind = 'inference';
    expect(
      authorityFacts(f.binding, f.pinned.loopId, f.pinned.id, f.pinned.definition, subject, spoof),
    ).toEqual([]);
    expect(() =>
      authorityFacts(
        f.binding,
        f.pinned.loopId,
        f.pinned.id,
        f.pinned.definition,
        subject,
        outputEvents(f, { type: 'ClaimRecord', issue: 7 }),
      ),
    ).toThrow();
    expect(() =>
      authorityFacts(
        f.binding,
        f.pinned.loopId,
        f.pinned.id,
        f.pinned.definition,
        subject,
        outputEvents(f, { ...claim, issue: 8 }),
      ),
    ).toThrow();
    expect(() =>
      authorityFacts(
        f.binding,
        f.pinned.loopId,
        f.pinned.id,
        f.pinned.definition,
        subject,
        outputEvents(f, {
          type: 'QaOutcome',
          repository: 'example/project',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          mergeSha: 'a'.repeat(40),
          outcome: 'passed',
        }),
      ),
    ).toThrow();
  });
  it('atomically consumes an issue attempt, refuses a forged poll key, and isolates unrelated subjects', async () => {
    const f = await foundation();
    const first = f.intent('first');
    const second = f.intent('second');
    const outcomes = await Promise.allSettled([
      f.admission.create(first),
      f.admission.create(second),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const holder = outcomes.find((result) => result.status === 'fulfilled');
    if (!holder || holder.status !== 'fulfilled') throw new Error('missing holder');
    await f.runs.update(holder.value.id, {
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', message: 'effect failed', resumable: true },
    });
    const forged = f.intent('new-key', true);
    await expect(f.admission.createPollItem(forged)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(await f.runs.get(forged.run.id)).toBeUndefined();
    const candidate = f.intent('manual-again');
    await expect(f.admission.create(candidate)).rejects.toMatchObject({
      code: 'TEMPLATE_SUBJECT_CONSUMED',
    });
    expect(await f.runs.get(candidate.run.id)).toBeUndefined();
    const subject = parseSubject((await f.instances.store.run(holder.value.id))!.subject);
    expect(
      await nextAttempt(f.instances.store, f.binding, ParentSubjectSchema.parse(subject)),
    ).toBe(1);
    expect(
      await f.instances.store.subjectRuns({
        ownerId: 'local',
        repository: 'elsewhere/repository',
        issue: 7,
        limit: 10,
      }),
    ).toEqual([]);
    await expect(
      f.runs.transition(holder.value.id, ['failed'], { status: 'running' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('permits only the same zero-effect allowlisted persisted prerequisite failure to resume', async () => {
    const f = await foundation();
    const input = f.intent('repair');
    await f.admission.create(input);
    const failure = {
      code: 'TEMPLATE_PREREQUISITE_UNAVAILABLE' as const,
      message: 'Missing role',
      resumable: true,
      details: { prerequisite: 'role', kind: 'role' },
    };
    await f.events.append(input.run.id, [{ type: 'run.failed', failure }]);
    const run = await f.runs.update(input.run.id, { status: 'failed', failure });
    await expect(f.runtime.hooks.beforeResume!({ run, events: [] })).resolves.toBeUndefined();
    const wrong = {
      ...run,
      failure: { ...failure, details: { prerequisite: 'invented', kind: 'role' } },
    };
    await expect(f.runtime.hooks.beforeResume!({ run: wrong, events: [] })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await f.events.append(run.id, [
      {
        type: 'node.started',
        nodeId: 'assistant',
        kind: 'inference',
        attempt: 1,
        configHash: 'effect',
      },
    ]);
    await expect(f.runtime.hooks.beforeResume!({ run, events: [] })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
  it('fails QA isolation with zero model turns and reconciles one fixed explanation across restart', async () => {
    const f = await foundation('qa');
    const input = f.intent('qa');
    const run = await f.admission.create(input);
    f.binding.manifest.prerequisites.push({
      id: 'isolation',
      label: 'Isolation',
      kind: 'isolation',
      blocking: 'runtime',
    });
    const immutable = await f.instances.store.get('local', f.binding.instanceId);
    if (!immutable) throw new Error('missing binding');
    const original = await f.instances.catalog.get('recipe');
    delete original.bundle.manifest.draftFile; // Synthetic automation-only package.
    original.bundle.manifest.prerequisites.push({
      id: 'isolation',
      label: 'Isolation',
      kind: 'isolation',
      blocking: 'runtime',
    });
    // Use a fresh immutable QA instance with the unavailable capability authored in its manifest.
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify(original.bundle.manifest),
    );
    const fresh = await f.instances.instantiate('local', 'recipe', {
      settings: f.binding.settings,
    });
    const stored = await f.instances.store.get('local', fresh.instance.id);
    if (!stored) throw new Error('missing QA binding');
    const subject = ParentSubjectSchema.parse({
      role: 'parent',
      kind: 'qa',
      instanceId: fresh.instance.id,
      templateVersion: '1.0.0',
      repository: 'example/project',
      issue: 8,
      attempt: 1,
      source: { kind: 'external' },
      pullRequest: 13,
      mergeSha: 'c'.repeat(40),
    });
    const qa = {
      ...input,
      run: {
        ...run,
        id: fakeUlid('fresh-qa'),
        loopId: fresh.instance.parentLoopId,
        versionId: fresh.instance.loops[0]!.versionId,
        invocationId: fakeUlid('fresh-qa-invocation'),
        lastEventSeq: 0,
      },
    };
    qa.initialThread = createInitialThread({
      runId: qa.run.id,
      loopId: qa.run.loopId,
      versionId: qa.run.versionId,
      invocation: {
        id: qa.run.invocationId,
        source: 'manual.api',
        trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
      },
    });
    qa.queued = { type: 'run.queued', initialThread: qa.initialThread };
    qa.pinnedLoopIds = [qa.run.loopId];
    await new SqliteTriggerAdmission(f.handle.db, f.events, async (store, candidate) => {
      await store.setSubject(candidate.run.id, subjectJson(subject));
      return { action: 'keep' };
    }).create(qa);
    const comments: { body: string }[] = [];
    const reporter = new ReconciledTemplateFailureReporter(f.instances, {
      comments: () => Promise.resolve(comments),
      post: (_repo, _issue, body) => {
        comments.push({ body });
        return Promise.resolve();
      },
    });
    const runtime = new TemplateRuntime(f.instances, undefined, reporter);
    const version = await f.instances.store.version(qa.run.versionId);
    if (!version) throw new Error('missing QA version');
    await expect(
      runtime.hooks.beforeExecute!({ run: qa.run, definition: version.definition, events: [] }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_ISOLATION_UNAVAILABLE',
      options: { resumable: false },
    });
    await expect(
      new TemplateRuntime(f.instances, undefined, reporter).hooks.beforeExecute!({
        run: qa.run,
        definition: version.definition,
        events: [],
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_ISOLATION_UNAVAILABLE' });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('QA did not run');
    expect(comments[0]?.body).toContain('issue state is unchanged');
    expect(f.harness.started).toHaveLength(0);
    expect(f.requests).toHaveLength(0);
    await expect(
      reporter.report(TemplateBindingSchema.parse(stored.binding), qa.run, subject, 'invented'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    expect(() =>
      checkedEvents({
        runId: run.id,
        lastEventSeq: 2,
        total: 1,
        firstSeq: 2,
        lastSeq: 2,
        invalidSeqs: 0,
        relevantCount: 1,
        rows: [
          { runId: run.id, seq: 2, ts: FIXTURE_TS, type: 'run.queued', nodeId: null, payload: {} },
        ],
      }),
    ).toThrow();
  });
});

type Foundation = Awaited<ReturnType<typeof foundation>>;
let fixtureRecipeId = 0;
async function recipe(
  f: Foundation,
  kind: 'implementation' | 'review' | 'qa',
  actions: string[],
  child = false,
) {
  const original = await new TemplateCatalog(
    fileURLToPath(new URL('../../templates', import.meta.url)),
    fileURLToPath(new URL('../..', import.meta.url)),
  ).get('starter');
  const bundle = structuredClone(original.bundle);
  delete bundle.manifest.draftFile; // Synthetic repository bindings have no starting-point asset.
  const key =
    (kind + '-' + actions.join('-') + (child ? '-child' : '')).slice(0, 50) +
    '-' +
    fixtureRecipeId++;
  bundle.manifest.id = key;
  bundle.manifest.kind = kind;
  bundle.manifest.supportEntry = f.binding.manifest.supportEntry;
  bundle.manifest.requiredSecrets = f.binding.manifest.requiredSecrets;
  const roles =
    kind === 'qa'
      ? (['qa', 'adversary'] as const)
      : kind === 'review'
        ? (['reviewer', 'fixer'] as const)
        : (['implementer'] as const);
  bundle.manifest.roles = roles.map((role) => ({ id: role, label: role, access: 'write' }));
  bundle.manifest.prerequisites = [
    { id: 'role', label: 'Role', kind: 'role', role: roles[0], blocking: 'authoring' },
  ];
  const parent = bundle.loops['parent']!;
  const descriptor = bundle.manifest.loops[0]!;
  descriptor.roleNodes = [{ nodeId: 'assistant', role: roles[0] }];
  const inference = parent.nodes.find((node) => node.kind === 'inference')!;
  if (roles.length > 1) {
    parent.nodes.splice(-1, 0, { ...inference, id: 'second', label: 'Second' });
    descriptor.roleNodes.push({ nodeId: 'second', role: roles[1]! });
  }
  parent.nodes.splice(
    1,
    0,
    ...actions.map(
      (action, index) =>
        LoopDefinitionSchema.parse({
          ...parent,
          nodes: [
            {
              id: 'support-' + index,
              kind: 'script',
              label: action,
              config: {
                command: 'graphgoblin-template-support',
                args: [action],
                stdin: 'thread',
                stdout: 'last-output',
              },
            },
          ],
          edges: [],
        }).nodes[0]!,
    ),
  );
  if (child) {
    bundle.loops['child'] = LoopDefinitionSchema.parse({
      ...original.bundle.loops['parent'],
      name: 'Child',
      nodes: original.bundle.loops['parent']!.nodes.filter((node) => node.kind !== 'inference'),
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'settings', port: 'in' } },
        { id: 'b', from: { node: 'settings', port: 'out' }, to: { node: 'done', port: 'in' } },
      ],
    });
    bundle.manifest.loops.push({
      key: 'child',
      file: 'child.json',
      dependsOn: [],
      roleNodes: [],
      settingsNodes: ['settings'],
      subloops: [],
    });
    descriptor.dependsOn = ['child'];
    descriptor.subloops = [{ nodeId: 'worker', loopKey: 'child' }];
    parent.nodes.splice(
      -1,
      0,
      LoopDefinitionSchema.parse({
        ...parent,
        nodes: [
          {
            id: 'worker',
            kind: 'subloop',
            label: 'Worker',
            config: { loopRef: { loopId: fakeUlid('placeholder-child'), version: 1 } },
          },
        ],
        edges: [],
      }).nodes[0]!,
    );
  }
  parent.edges = parent.nodes.slice(1).map((node, index) => ({
    id: 'chain-' + index,
    from: { node: parent.nodes[index]!.id, port: 'out' },
    to: { node: node.id, port: 'in' },
  }));
  await mkdir(join(f.root, key));
  await writeFile(join(f.root, key, 'manifest.json'), JSON.stringify(bundle.manifest));
  await writeFile(
    join(f.root, key, 'loop.json'),
    JSON.stringify({
      format: 'graphgoblin-loop',
      formatVersion: 3,
      exportedAt: FIXTURE_TS,
      loop: parent,
    }),
  );
  if (child)
    await writeFile(
      join(f.root, key, 'child.json'),
      JSON.stringify({
        format: 'graphgoblin-loop',
        formatVersion: 3,
        exportedAt: FIXTURE_TS,
        loop: bundle.loops['child'],
      }),
    );
  const { readFile } = await import('node:fs/promises');
  const catalog = JSON.parse(await readFile(join(f.root, 'catalog.json'), 'utf8')) as string[];
  catalog.push(key + '/manifest.json');
  await writeFile(join(f.root, 'catalog.json'), JSON.stringify(catalog));
  const selected = Object.values(f.binding.settings.roles)[0]!;
  if (!('repository' in f.binding.settings)) throw new Error('repository fixture required');
  const settings = TemplateSettingsSchemas[kind].parse({
    kind,
    repository: f.binding.settings.repository,
    supportReadKey: f.binding.settings.supportReadKey,
    roles: Object.fromEntries(roles.map((role) => [role, selected])),
  });
  const { instance } = await f.instances.instantiate('local', key, { settings });
  const stored = await f.instances.store.get('local', instance.id);
  if (!stored) throw new Error('missing recipe');
  const binding = TemplateBindingSchema.parse(stored.binding);
  const pinned = await f.instances.store.version(
    instance.loops.find((loop) => loop.key === 'parent')!.versionId,
  );
  if (!pinned) throw new Error('missing recipe version');
  return { instance, binding, pinned };
}
function recipeIntent(
  r: Awaited<ReturnType<typeof recipe>>,
  seed: string,
  poll = false,
): RunAdmission {
  const run: RunRecord = {
    id: fakeUlid(r.instance.id + seed),
    ownerId: 'local',
    loopId: r.instance.parentLoopId,
    versionId: r.pinned.id,
    invocationId: fakeUlid('invocation:' + r.instance.id + seed),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: poll ? 'poll' : 'manual.api',
      trigger: {
        nodeId: 'start',
        kind: poll ? 'poll' : 'manual',
        payload: null,
        receivedAt: FIXTURE_TS,
        ...(poll ? { dedupeKey: seed } : {}),
      },
    },
  });
  const subloopVersions = Object.fromEntries(
    r.instance.loops
      .filter((loop) => loop.key !== 'parent')
      .map((loop) => [loop.loopId, loop.versionId]),
  );
  return {
    run,
    initialThread,
    queued: {
      type: 'run.queued',
      initialThread,
      ...(Object.keys(subloopVersions).length ? { subloopVersions } : {}),
    },
    pinnedLoopIds: [run.loopId, ...Object.keys(subloopVersions)],
  };
}
async function history(
  f: Foundation,
  r: Awaited<ReturnType<typeof recipe>>,
  seed: string,
  fields: { attempt: number; pullRequest?: number; head?: string; mergeSha?: string },
  values: JsonValue[],
  status: RunRecord['status'] = 'succeeded',
) {
  const input = recipeIntent(r, seed);
  const sources = fields.pullRequest
    ? await f.instances.store.prFactCandidates('local', 'example/project', fields.pullRequest, 65)
    : [];
  const source =
    r.binding.manifest.kind === 'implementation'
      ? { kind: 'implementation', runId: input.run.id }
      : sources.length
        ? { kind: 'implementation', runId: sources[0]!.run.id }
        : { kind: 'external' };
  const subject = ParentSubjectSchema.parse({
    source,
    role: 'parent',
    kind: r.binding.manifest.kind,
    instanceId: r.instance.id,
    templateVersion: r.binding.manifest.version,
    repository: 'example/project',
    issue: 7,
    ...fields,
  });
  await new SqliteTriggerAdmission(f.handle.db, f.events, async (store, candidate) => {
    await store.setSubject(candidate.run.id, subjectJson(subject));
    return { action: 'keep' };
  }).create(input);
  for (let index = 0; index < values.length; index++) {
    const nodeId = 'support-' + index;
    const configHash = r.binding.loops.find((loop) => loop.key === 'parent')!.nodes[nodeId]!
      .configHash;
    await f.events.append(input.run.id, [
      { type: 'node.started', nodeId, kind: 'script', attempt: 1, configHash },
      {
        type: 'node.finished',
        nodeId,
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/' + nodeId,
            value: { nodeId, at: FIXTURE_TS, value: values[index]! },
          },
        ],
      },
    ]);
  }
  return f.runs.update(input.run.id, { status });
}
async function implementationHistory(f: Foundation, attempt = 1, pullRequest = 12) {
  const r = await recipe(f, 'implementation', ['pr-created']);
  const run = await history(f, r, 'implementation', { attempt }, [
    {
      type: 'PrCreated',
      repository: 'example/project',
      issue: 7,
      attempt,
      pullRequest,
      head: 'a'.repeat(40),
    },
  ]);
  return { ...r, run };
}
function runtimeAdmission(
  f: Foundation,
  r: Awaited<ReturnType<typeof recipe>>,
  selected: {
    kind: 'review' | 'qa' | 'implementation';
    attempt: number;
    pullRequest?: number;
    head?: string;
    mergeSha?: string;
  },
) {
  const source: TemplateAuthoritySource = {
    resolve: async () => {
      if (selected.kind === 'implementation')
        return { kind: 'implementation', repository: 'example/project', issue: 7 };
      const prior = await f.instances.store.prFactCandidates(
        'local',
        'example/project',
        selected.pullRequest!,
        65,
      );
      return {
        repository: 'example/project',
        issue: 7,
        ...selected,
        kind: selected.kind,
        source: prior.length
          ? { kind: 'implementation', runId: prior[0]!.run.id }
          : { kind: 'external' },
      };
    },
    recheck: () => Promise.resolve(),
  };
  const runtime = new TemplateRuntime(f.instances, source);
  return {
    runtime,
    admission: templateAdmission(
      new SqliteTriggerAdmission(f.handle.db, f.events, (store, input, poll) =>
        runtime.afterRunStaged(store, input, poll),
      ),
      runtime,
    ),
    recipe: r,
  };
}
describe('repository attempt and produced-head authority', () => {
  it('advances an authentic rework while already open without fabricating an actual reopen', async () => {
    const f = await foundation();
    await implementationHistory(f);
    const qa = await recipe(f, 'qa', ['qa-rework']);
    await history(f, qa, 'qa', { attempt: 1, pullRequest: 12, mergeSha: 'b'.repeat(40) }, [
      {
        type: 'ReworkRequest',
        repository: 'example/project',
        issue: 7,
        attempt: 1,
        pullRequest: 12,
        mergeSha: 'b'.repeat(40),
        request: 1,
      },
    ]);
    const candidate = ParentSubjectSchema.parse({
      role: 'parent',
      kind: 'implementation',
      instanceId: f.binding.instanceId,
      templateVersion: '1.0.0',
      repository: 'example/project',
      issue: 7,
      attempt: 1,
      source: { kind: 'implementation', runId: fakeUlid('proof') },
    });
    expect(await nextAttempt(f.instances.store, f.binding, candidate)).toBe(2);
    expect(
      (
        await f.instances.store.subjectRuns({
          ownerId: 'local',
          repository: 'example/project',
          issue: 7,
          limit: 10,
        })
      ).map((row) => row.run.id),
    ).toHaveLength(2);
    const input = f.intent('attempt-two');
    await f.admission.create(input);
    expect(parseSubject((await f.instances.store.run(input.run.id))!.subject).attempt).toBe(2);
  });
  it('preserves trusted attempt two for review and QA and rejects a mismatching authenticated source', async () => {
    const f = await foundation();
    await implementationHistory(f, 2);
    for (const kind of ['review', 'qa'] as const) {
      const r = await recipe(f, kind, ['claim']);
      const selected = {
        kind,
        attempt: 2,
        pullRequest: 12,
        ...(kind === 'review' ? { head: 'c'.repeat(40) } : { mergeSha: 'd'.repeat(40) }),
      };
      const { admission } = runtimeAdmission(f, r, selected);
      const input = recipeIntent(r, 'correct');
      input.initialThread.invocation.trigger.payload = { attempt: 3 };
      await admission.create(input);
      expect(parseSubject((await f.instances.store.run(input.run.id))!.subject).attempt).toBe(2);
      const bad = runtimeAdmission(f, r, { ...selected, attempt: 1 });
      await expect(bad.admission.create(recipeIntent(r, 'wrong'))).rejects.toMatchObject({
        code: 'AUTHORITY_CONFLICT',
      });
      expect(await f.runs.get(recipeIntent(r, 'wrong').run.id)).toBeUndefined();
    }
  });
  it('permanently consumes an authentic fixer-produced head across terminal runs and rejects wrong-PR facts', async () => {
    const f = await foundation();
    await implementationHistory(f);
    const review = await recipe(f, 'review', ['fixer-head']);
    await history(
      f,
      review,
      'original',
      { attempt: 1, pullRequest: 12, head: 'a'.repeat(40) },
      [
        {
          type: 'FixerHead',
          repository: 'example/project',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          head: 'c'.repeat(40),
        },
      ],
      'failed',
    );
    const reused = runtimeAdmission(f, review, {
      kind: 'review',
      attempt: 1,
      pullRequest: 12,
      head: 'c'.repeat(40),
    });
    const reusedPoll = recipeIntent(review, 'poll-reused', true);
    reusedPoll.initialThread.invocation.trigger.payload = {
      id: 12,
      payload: { pullRequest: 12, head: 'c'.repeat(40) },
    };
    reusedPoll.initialThread.invocation.trigger.dedupeKey = '12:' + 'c'.repeat(40);
    expect(await reused.admission.createPollItem(reusedPoll)).toBeUndefined();
    await expect(
      reused.admission.create(recipeIntent(review, 'manual-reused')),
    ).rejects.toMatchObject({ code: 'TEMPLATE_SUBJECT_CONSUMED' });
    const next = runtimeAdmission(f, review, {
      kind: 'review',
      attempt: 1,
      pullRequest: 12,
      head: 'd'.repeat(40),
    });
    await expect(next.admission.create(recipeIntent(review, 'new-head'))).resolves.toMatchObject({
      status: 'queued',
    });
    await f.runs.update(recipeIntent(review, 'new-head').run.id, { status: 'succeeded' });
    const malformed = await recipe(f, 'review', ['fixer-head', 'claim']);
    await history(
      f,
      malformed,
      'bad-proof',
      { attempt: 1, pullRequest: 12, head: 'e'.repeat(40) },
      [
        {
          type: 'FixerHead',
          repository: 'example/project',
          issue: 7,
          attempt: 1,
          pullRequest: 99,
          head: 'f'.repeat(40),
        },
      ],
    );
    await expect(next.admission.create(recipeIntent(review, 'conflict'))).rejects.toMatchObject({
      code: 'AUTHORITY_CONFLICT',
    });
  });
});

function workerIntent(
  r: Awaited<ReturnType<typeof recipe>>,
  parent: RunRecord,
  seed: string,
): RunAdmission {
  const child = r.instance.loops.find((loop) => loop.key === 'child')!;
  const run: RunRecord = {
    ...parent,
    id: fakeUlid(parent.id + seed),
    loopId: child.loopId,
    versionId: child.versionId,
    invocationId: fakeUlid('worker-invocation:' + parent.id + seed),
    parentRunId: parent.id,
    currentNodeId: undefined,
    status: 'queued',
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'subloop',
      caller: { kind: 'run', id: parent.id },
      trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  return {
    run,
    initialThread,
    queued: { type: 'run.queued', initialThread },
    pinnedLoopIds: [child.loopId],
  };
}
describe('trusted original child visits', () => {
  it('recovers the same persisted running child after a commit/link gap and repeated parent start', async () => {
    const f = await foundation();
    const r = await recipe(f, 'implementation', ['claim'], true);
    const parent = await history(
      f,
      r,
      'parent',
      { attempt: 1 },
      [{ type: 'ClaimRecord', repository: 'example/project', issue: 7, attempt: 1 }],
      'running',
    );
    const node = r.pinned.definition.nodes.find((item) => item.id === 'worker')!;
    const starts = await f.events.append(parent.id, [
      {
        type: 'node.started',
        nodeId: 'worker',
        kind: 'subloop',
        attempt: 1,
        configHash: stableHash(node.config),
      },
    ]);
    const current = await f.runs.update(parent.id, { currentNodeId: 'worker' });
    const { admission } = runtimeAdmission(f, r, { kind: 'implementation', attempt: 1 });
    const first = workerIntent(r, current, 'first');
    const original = await admission.create(first);
    await f.runs.update(original.id, { status: 'running' });
    await f.events.append(parent.id, [
      {
        type: 'node.started',
        nodeId: 'worker',
        kind: 'subloop',
        attempt: 2,
        configHash: stableHash(node.config),
      },
    ]);
    const retry = workerIntent(r, current, 'retry');
    const recovered = await admission.create(retry);
    expect(recovered.id).toBe(original.id);
    expect(recovered.status).toBe('running');
    expect(parseSubject((await f.instances.store.run(original.id))!.subject)).toMatchObject({
      role: 'worker',
      visit: starts[0]!.seq,
      parentRunId: parent.id,
    });
    expect(await f.runs.get(retry.run.id)).toBeUndefined();
    expect(await f.events.read(retry.run.id)).toEqual([]);
    await f.events.append(parent.id, [
      { type: 'node.finished', nodeId: 'worker', durationMs: 0, patch: [] },
      {
        type: 'node.started',
        nodeId: 'worker',
        kind: 'subloop',
        attempt: 3,
        configHash: stableHash(node.config),
      },
    ]);
    const later = await admission.create(workerIntent(r, current, 'later'));
    expect(later.id).not.toBe(original.id);
  });
  it.each([
    'manual',
    'replay',
    'wrong-caller',
    'terminal-parent',
    'wrong-start',
    'wrong-pin',
    'missing-claim',
  ])('refuses %s before worker persistence', async (caseName) => {
    const f = await foundation();
    const r = await recipe(f, 'implementation', ['claim'], true);
    const parent = await history(
      f,
      r,
      'parent',
      { attempt: 1 },
      caseName === 'missing-claim'
        ? []
        : [{ type: 'ClaimRecord', repository: 'example/project', issue: 7, attempt: 1 }],
      'running',
    );
    const node = r.pinned.definition.nodes.find((item) => item.id === 'worker')!;
    await f.events.append(parent.id, [
      {
        type: 'node.started',
        nodeId: 'worker',
        kind: 'subloop',
        attempt: 1,
        configHash: caseName === 'wrong-start' ? 'changed' : stableHash(node.config),
      },
    ]);
    const current = await f.runs.update(parent.id, {
      currentNodeId: 'worker',
      ...(caseName === 'terminal-parent' ? { status: 'failed' as const } : {}),
    });
    const input = workerIntent(r, current, caseName);
    if (caseName === 'manual') {
      input.initialThread.invocation.source = 'manual.api';
      delete input.run.parentRunId;
    }
    if (caseName === 'replay')
      input.initialThread.invocation.replayOf = { runId: parent.id, nodeId: 'worker' };
    if (caseName === 'wrong-caller')
      input.initialThread.invocation.caller = { kind: 'run', id: fakeUlid('wrong-parent') };
    if (caseName === 'wrong-pin') {
      const queued = recipeIntent(r, 'parent').queued;
      await f.handle.client.execute({
        sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
        args: [
          JSON.stringify({
            ...queued,
            subloopVersions: {
              [r.pinned.definition.nodes.find((item) => item.kind === 'subloop')!.config.loopRef
                .loopId]: fakeUlid('wrong-pinned-child-version'),
            },
          }),
          parent.id,
        ],
      });
    }
    const { admission } = runtimeAdmission(f, r, { kind: 'implementation', attempt: 1 });
    await expect(admission.create(input)).rejects.toMatchObject({
      code:
        caseName === 'wrong-start' || caseName === 'wrong-pin' || caseName === 'missing-claim'
          ? 'AUTHORITY_CONFLICT'
          : 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(await f.runs.get(input.run.id)).toBeUndefined();
    expect(await f.events.read(input.run.id)).toEqual([]);
    expect(f.harness.started).toHaveLength(0);
    expect(f.requests).toHaveLength(0);
  });
});

function externalAdmission(
  f: Foundation,
  kind: 'review' | 'qa',
  issue: number | null = 7,
  attempt: number | null = issue === null ? null : 1,
) {
  const source: TemplateAuthoritySource = {
    resolve: () =>
      Promise.resolve({
        kind,
        repository: 'example/project',
        issue,
        attempt,
        source: { kind: 'external' },
        pullRequest: 12,
        ...(kind === 'review' ? { head: 'd'.repeat(40) } : { mergeSha: 'b'.repeat(40) }),
      }),
    recheck: () => Promise.resolve(),
  };
  const runtime = new TemplateRuntime(f.instances, source);
  return templateAdmission(
    new SqliteTriggerAdmission(f.handle.db, f.events, (store, input, poll) =>
      runtime.afterRunStaged(store, input, poll),
    ),
    runtime,
  );
}
describe('trusted standalone original subjects', () => {
  it('admits a fresh external review with explicit no-linked-issue provenance and ignores authored attempts', async () => {
    const f = await foundation();
    const review = await recipe(f, 'review', ['claim']);
    const admission = externalAdmission(f, 'review', null);
    const input = recipeIntent(review, 'standalone');
    input.initialThread.invocation.trigger.payload = {
      issue: 123,
      attempt: 3,
      source: { kind: 'implementation', runId: fakeUlid('spoof') },
    };
    const run = await admission.create(input);
    expect(parseSubject((await f.instances.store.run(run.id))!.subject)).toMatchObject({
      issue: null,
      attempt: null,
      source: { kind: 'external' },
    });
    expect(await f.instances.store.prFactCandidates('local', 'example/project', 12, 10)).toEqual(
      [],
    );
    expect(f.requests).toHaveLength(0);
    expect(f.harness.started).toHaveLength(0);
  });
  it('advances genuine external QA rework into attempt two after restart without inventing PrCreated or reopening', async () => {
    const f = await foundation();
    const qa = await recipe(f, 'qa', ['qa-rework']);
    const admission = externalAdmission(f, 'qa');
    const input = recipeIntent(qa, 'external-qa');
    const run = await admission.create(input);
    const node = qa.pinned.definition.nodes.find((item) => item.id === 'support-0')!;
    await f.events.append(run.id, [
      {
        type: 'node.started',
        nodeId: node.id,
        kind: 'script',
        attempt: 1,
        configHash: stableHash(node.config),
      },
      {
        type: 'node.finished',
        nodeId: node.id,
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/' + node.id,
            value: {
              nodeId: node.id,
              at: FIXTURE_TS,
              value: {
                type: 'ReworkRequest',
                repository: 'example/project',
                issue: 7,
                attempt: 1,
                pullRequest: 12,
                mergeSha: 'b'.repeat(40),
                request: 1,
              },
            },
          },
        ],
      },
    ]);
    await f.runs.update(run.id, { status: 'succeeded' });
    const restarted = new TemplateRuntime(f.instances, f.authority);
    const impl = templateAdmission(
      new SqliteTriggerAdmission(f.handle.db, f.events, (store, candidate, poll) =>
        restarted.afterRunStaged(store, candidate, poll),
      ),
      restarted,
    );
    const next = f.intent('external-attempt-two');
    await impl.create(next);
    expect(parseSubject((await f.instances.store.run(next.run.id))!.subject)).toMatchObject({
      kind: 'implementation',
      attempt: 2,
      source: { kind: 'implementation', runId: next.run.id },
    });
    expect(await f.instances.store.prFactCandidates('local', 'example/project', 12, 10)).toEqual(
      [],
    );
    await f.runs.update(next.run.id, { status: 'failed' });
    await expect(impl.create(f.intent('consumed-two'))).rejects.toMatchObject({
      code: 'TEMPLATE_SUBJECT_CONSUMED',
    });
  });
  it.each(['downgrade', 'conflicting-history', 'missing-qa-link', 'forged-external-attempt'])(
    'refuses %s without a new parent or turn',
    async (caseName) => {
      const f = await foundation();
      if (caseName === 'downgrade') await implementationHistory(f, 2);
      if (caseName === 'conflicting-history') await f.admission.create(f.intent('reserved'));
      const kind = caseName === 'missing-qa-link' ? 'qa' : 'review';
      const r = await recipe(f, kind, ['claim']);
      const input = recipeIntent(r, caseName);
      const admission = externalAdmission(
        f,
        kind,
        caseName === 'missing-qa-link' ? null : 7,
        caseName === 'forged-external-attempt' ? 2 : caseName === 'missing-qa-link' ? null : 1,
      );
      await expect(admission.create(input)).rejects.toMatchObject({ code: 'AUTHORITY_CONFLICT' });
      expect(await f.runs.get(input.run.id)).toBeUndefined();
      expect(f.requests).toHaveLength(0);
      expect(f.harness.started).toHaveLength(0);
    },
  );
});

describe('private probe and output refusal boundaries', () => {
  it('launches only a frozen published poll probe with private stdin and no unrelated environment', async () => {
    const f = await foundation('implementation', 'poll', true);
    const { SqliteLoopRepository } = await import('@graphgoblin/infrastructure/sqlite');
    await new SqliteLoopRepository(f.handle.db, new FakeClock(), {
      next: () => fakeUlid('unused'),
    }).publish(f.pinned.loopId);
    const request: ScriptRunRequest = {
      command: 'graphgoblin-template-support',
      args: ['poll'],
      cwd: 'ignored',
      env: {},
      executionIdentity: {
        kind: 'poll',
        ownerId: 'local',
        loopId: f.pinned.loopId,
        versionId: f.pinned.id,
        nodeId: 'start',
      },
      signal: new AbortController().signal,
    };
    expect(await f.scripts.run(request)).toMatchObject({ stdout: '{}', stderr: '' });
    expect(JSON.parse(f.requests[0]!.stdin!)).toMatchObject({ input: null });
    expect(f.requests[0]?.env).toEqual({ PATH: 'safe' });
    const wrong = {
      ...request,
      executionIdentity: { ...request.executionIdentity!, nodeId: 'claim' },
    };
    await expect(f.scripts.run(wrong)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
  it('refuses draft polling, missing secrets, altered args and invalid thread identities before launch', async () => {
    const f = await foundation('implementation', 'poll', true);
    const poll: ScriptRunRequest = {
      command: 'graphgoblin-template-support',
      args: ['poll'],
      cwd: f.root,
      env: {},
      executionIdentity: {
        kind: 'poll',
        ownerId: 'local',
        loopId: f.pinned.loopId,
        versionId: f.pinned.id,
        nodeId: 'start',
      },
      signal: new AbortController().signal,
    };
    await expect(f.scripts.run(poll)).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    const node = await f.executing();
    const missingThread: ScriptRunRequest = { ...node.request };
    delete missingThread.stdin;
    for (const request of [
      missingThread,
      { ...node.request, stdin: JSON.stringify({}) },
      { ...node.request, args: ['unexpected'] },
    ])
      await expect(f.scripts.run(request)).rejects.toMatchObject({
        code: 'TEMPLATE_AUTHORITY_REFUSED',
      });
    f.scripts = new PrivateTemplateScripts({
      instances: f.instances,
      raw: {
        run: () => {
          throw new Error('must not launch');
        },
      },
      apiKeys: f.apiKeys,
      secretsFor: () => new InMemorySecrets(),
    });
    await expect(f.scripts.run(node.request)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(f.requests).toHaveLength(0);
  });
  it.each([
    'exit',
    'timeout',
    'stderr-overflow',
    'stdout-size',
    'stderr-size',
    'redacted-key-collision',
  ])('rejects %s with a safe fixed diagnostic before recording output', async (caseName) => {
    const f = await foundation();
    const { request } = await f.executing();
    if (caseName === 'exit') f.setResult({ exitCode: 1 });
    if (caseName === 'timeout') f.setResult({ timedOut: true });
    if (caseName === 'stderr-overflow') f.setResult({ stderrOverflow: true });
    if (caseName === 'stdout-size') f.setResult({ stdout: '"' + 'x'.repeat(65536) + '"' });
    if (caseName === 'stderr-size') f.setResult({ stderr: 'x'.repeat(8193) });
    if (caseName === 'redacted-key-collision')
      f.setResult({ stdout: JSON.stringify({ [f.key.token]: 1, '[redacted]': 2 }) });
    await expect(f.scripts.run(request)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
      message: 'The installed private support request was refused.',
    });
  });
});
describe('pre-execution authority and trusted reporting', () => {
  it.each(['prerequisite', 'authority'] as const)(
    'recovers a progressed repository run with lost %s as manual recovery without another effect',
    async (reason) => {
      const f = await foundation();
      const { run } = await f.executing('interrupted');
      const ports = createFakePorts();
      ports.loops.add({
        id: f.pinned.id,
        loopId: run.loopId,
        version: f.pinned.version,
        status: 'published',
        definition: f.pinned.definition,
        createdAt: f.pinned.createdAt,
        publishedAt: FIXTURE_TS,
      });
      let reported = 0;
      const runtime = new TemplateRuntime(f.instances, f.authority, {
        report: () => {
          reported++;
          return Promise.resolve();
        },
      });
      if (reason === 'prerequisite') f.harness.preflightResult.ok = false;
      else f.authority.recheck = () => Promise.reject(new Error('private source failure'));
      const manager = new RunManager(
        {
          ...ports,
          runs: f.runs,
          events: f.events,
          admission: f.admission,
          harnesses: { codex: f.harness },
        },
        { ...DEFAULT_TEST_SETTINGS, ...runtime.hooks },
      );
      try {
        await manager.start();
        await manager.waitForIdle();
        const failed = await f.runs.get(run.id);
        expect(failed).toMatchObject({
          status: 'failed',
          failure: {
            code:
              reason === 'prerequisite'
                ? 'TEMPLATE_PREREQUISITE_UNAVAILABLE'
                : 'TEMPLATE_AUTHORITY_REFUSED',
            resumable: false,
          },
        });
        expect(failed?.failure?.message).toContain('Earlier effects may have occurred');
        expect(failed?.failure?.message).not.toContain('no workflow effects ran');
        expect(reported).toBe(0);
        expect(
          (await f.events.read(run.id)).filter((event) => event.type === 'node.started'),
        ).toHaveLength(1);
        expect(f.harness.started).toHaveLength(0);
        expect(ports.scripts.calls).toHaveLength(0);
        await expect(manager.resume(run.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
      } finally {
        manager.stop();
        await manager.waitForIdle();
      }
    },
  );

  it('rechecks the actual parent before effects and fails closed on lost eligibility or missing admission', async () => {
    const f = await foundation();
    const input = f.intent('ready');
    const run = await f.admission.create(input);
    let checked = 0;
    f.authority.recheck = () => {
      checked++;
      return Promise.resolve();
    };
    await expect(
      f.runtime.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).resolves.toBeUndefined();
    expect(checked).toBe(1);
    expect(f.requests).toHaveLength(0);
    expect(f.harness.started).toHaveLength(0);
    f.authority.recheck = () => Promise.reject(new Error('private discovery error'));
    await expect(
      f.runtime.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    await f.handle.client.execute({
      sql: 'UPDATE runs SET template_subject = NULL WHERE id = ?',
      args: [run.id],
    });
    await expect(
      f.runtime.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    const replay = f.intent('replay');
    replay.initialThread.invocation.replayOf = { runId: run.id, nodeId: 'assistant' };
    await expect(f.admission.create(replay)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    await expect(
      f.runtime.hooks.beforeExecute!({
        run: { ...run, loopId: fakeUlid('ordinary') },
        definition: f.pinned.definition,
        events: [],
      }),
    ).resolves.toBeUndefined();
  });
  it('distinguishes missing and failed reporting from a reconciled repairable prerequisite failure', async () => {
    const f = await foundation();
    const input = f.intent('missing-role');
    const run = await f.admission.create(input);
    f.harness.preflightResult.ok = false;
    await expect(
      f.runtime.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    const failed = new TemplateRuntime(f.instances, f.authority, {
      report: () => Promise.reject(new Error('secret report failure')),
    });
    await expect(
      failed.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    let reported = 0;
    const ready = new TemplateRuntime(f.instances, f.authority, {
      report: (_binding, _run, _subject, code) => {
        expect(code).toBe('TEMPLATE_PREREQUISITE_UNAVAILABLE');
        reported++;
        return Promise.resolve();
      },
    });
    await expect(
      ready.hooks.beforeExecute!({ run, definition: f.pinned.definition, events: [] }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_PREREQUISITE_UNAVAILABLE',
      options: { resumable: true, details: { prerequisite: 'role', kind: 'role' } },
    });
    expect(reported).toBe(1);
    expect(f.requests).toHaveLength(0);
    expect(f.harness.started).toHaveLength(0);
  });
  it('refuses changed immutable execution configuration before eligibility or a model turn', async () => {
    const f = await foundation();
    const input = f.intent('changed-binding');
    const run = await f.admission.create(input);
    const changed = structuredClone(f.pinned.definition);
    changed.settings.maxIterations++;
    await f.handle.client.execute({
      sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
      args: [JSON.stringify(changed), f.pinned.id],
    });
    await expect(
      f.runtime.hooks.beforeExecute!({ run, definition: changed, events: [] }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_BINDING_CHANGED', options: { resumable: false } });
    expect(f.harness.started).toHaveLength(0);
  });
});

describe('bounded authenticated rework and proof refusal', () => {
  it('retains exactly two independent rework requests/reopenings and refuses a third implementation advance', async () => {
    const f = await foundation();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const pullRequest = 11 + attempt;
      const mergeSha = String(attempt).repeat(40);
      await implementationHistory(f, attempt, pullRequest);
      const qa = await recipe(f, 'qa', ['qa-rework', 'issue-reopened']);
      await history(f, qa, 'qa-' + attempt, { attempt, pullRequest, mergeSha }, [
        {
          type: 'ReworkRequest',
          repository: 'example/project',
          issue: 7,
          attempt,
          pullRequest,
          mergeSha,
          request: Math.min(attempt, 2),
        },
        {
          type: 'IssueReopened',
          repository: 'example/project',
          issue: 7,
          attempt,
          pullRequest,
          mergeSha,
          request: Math.min(attempt, 2),
        },
      ]);
      const candidate = ParentSubjectSchema.parse({
        role: 'parent',
        kind: 'implementation',
        instanceId: f.binding.instanceId,
        templateVersion: '1.0.0',
        repository: 'example/project',
        issue: 7,
        attempt: 1,
        source: { kind: 'implementation', runId: fakeUlid('cap-candidate') },
      });
      if (attempt < 3)
        expect(await nextAttempt(f.instances.store, f.binding, candidate)).toBe(attempt + 1);
      else
        await expect(nextAttempt(f.instances.store, f.binding, candidate)).rejects.toMatchObject({
          code: 'AUTHORITY_CONFLICT',
        });
    }
  });
  it.each(['wrong-pr', 'wrong-merge', 'wrong-counter', 'duplicate-reopen'])(
    'refuses %s without advancing an authentic issue baseline',
    async (caseName) => {
      const f = await foundation();
      await implementationHistory(f);
      const actions =
        caseName === 'duplicate-reopen'
          ? ['qa-rework', 'issue-reopened', 'issue-reopened']
          : ['qa-rework'];
      const qa = await recipe(f, 'qa', actions);
      const request = {
        type: 'ReworkRequest',
        repository: 'example/project',
        issue: 7,
        attempt: 1,
        pullRequest: caseName === 'wrong-pr' ? 13 : 12,
        mergeSha: caseName === 'wrong-merge' ? 'c'.repeat(40) : 'b'.repeat(40),
        request: caseName === 'wrong-counter' ? 2 : 1,
      };
      const reopened = {
        type: 'IssueReopened',
        repository: 'example/project',
        issue: 7,
        attempt: 1,
        pullRequest: 12,
        mergeSha: 'b'.repeat(40),
        request: 1,
      };
      await history(
        f,
        qa,
        'bad',
        { attempt: 1, pullRequest: 12, mergeSha: 'b'.repeat(40) },
        caseName === 'duplicate-reopen' ? [request, reopened, reopened] : [request],
      );
      const input = f.intent('refused');
      await expect(f.admission.create(input)).rejects.toMatchObject({ code: 'AUTHORITY_CONFLICT' });
      expect(await f.runs.get(input.run.id)).toBeUndefined();
    },
  );
  it('rejects a missing declared output, wrong output node and a stale recovered-start hash as authority', async () => {
    const f = await foundation();
    const subject = ParentSubjectSchema.parse({
      role: 'parent',
      kind: 'implementation',
      instanceId: f.binding.instanceId,
      templateVersion: '1.0.0',
      repository: 'example/project',
      issue: 7,
      attempt: 1,
      source: { kind: 'implementation', runId: fakeUlid('proof') },
    });
    const claim = { type: 'ClaimRecord', repository: 'example/project', issue: 7, attempt: 1 };
    expect(() =>
      authorityFacts(
        f.binding,
        f.pinned.loopId,
        f.pinned.id,
        f.pinned.definition,
        subject,
        outputEvents(f, claim, 'missing', false),
      ),
    ).toThrow();
    const wrong = outputEvents(f, claim);
    if (wrong[1]?.type !== 'node.finished') throw new Error('fixture');
    wrong[1].patch = [
      {
        op: 'add',
        path: '/outputs/claim',
        value: { nodeId: 'other', at: FIXTURE_TS, value: claim },
      },
    ];
    expect(() =>
      authorityFacts(f.binding, f.pinned.loopId, f.pinned.id, f.pinned.definition, subject, wrong),
    ).toThrow();
    const stale = outputEvents(f, claim);
    if (stale[0]?.type !== 'node.started') throw new Error('fixture');
    const recovered = { ...stale[0], seq: 2, attempt: 2, configHash: 'changed' };
    expect(
      authorityFacts(f.binding, f.pinned.loopId, f.pinned.id, f.pinned.definition, subject, [
        stale[0],
        recovered,
        stale[1]!,
      ]),
    ).toEqual([]);
    expect(() =>
      checkedEvents({
        runId: fakeUlid('oversize'),
        lastEventSeq: 1001,
        total: 1001,
        firstSeq: 1,
        lastSeq: 1001,
        invalidSeqs: 0,
        relevantCount: 1001,
        rows: Array.from({ length: 1001 }, () => ({
          runId: fakeUlid('oversize'),
          seq: 1,
          ts: FIXTURE_TS,
          type: 'run.queued',
          nodeId: null,
          payload: {},
        })),
      }),
    ).toThrow();
  });
});
describe('fixed report reconciliation refusal', () => {
  it.each([
    'duplicate',
    'overflow',
    'terminal',
    'wrong-owner',
    'wrong-subject',
    'post-failure',
    'progressed',
  ])('refuses %s without an extra explanatory effect', async (caseName) => {
    const f = await foundation();
    const input = f.intent('report');
    const run = await f.admission.create(input);
    const subject = parseSubject((await f.instances.store.run(run.id))!.subject);
    if (subject.role !== 'parent') throw new Error('fixture');
    const comments: { body: string }[] = [];
    let posts = 0;
    const reporter = new ReconciledTemplateFailureReporter(f.instances, {
      comments: () => Promise.resolve(comments),
      post: (_repo, _issue, body) => {
        posts++;
        if (caseName === 'post-failure') return Promise.reject(new Error('synthetic'));
        comments.push({ body });
        return Promise.resolve();
      },
    });
    if (caseName === 'duplicate') {
      await reporter.report(f.binding, run, subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
      comments.push({ ...comments[0]! });
      posts = 0;
    }
    if (caseName === 'overflow')
      comments.push(...Array.from({ length: 101 }, () => ({ body: 'existing' })));
    if (caseName === 'terminal') await f.runs.update(run.id, { status: 'succeeded' });
    if (caseName === 'progressed')
      await f.events.append(run.id, [
        {
          type: 'node.started',
          nodeId: 'claim',
          kind: 'script',
          attempt: 1,
          configHash: f.binding.loops[0]!.nodes['claim']!.configHash,
        },
      ]);
    const actualRun = caseName === 'wrong-owner' ? { ...run, ownerId: 'other' } : run;
    const actualSubject = caseName === 'wrong-subject' ? { ...subject, issue: 8 } : subject;
    await expect(
      reporter.report(f.binding, actualRun, actualSubject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE'),
    ).rejects.toBeDefined();
    expect(posts).toBe(caseName === 'post-failure' ? 1 : 0);
    expect(f.requests).toHaveLength(0);
    expect(f.harness.started).toHaveLength(0);
  });
});

describe('pinned evaluation role admission', () => {
  it('checks explicit decision and inherited exit LLM selections in the actual edited loop', async () => {
    const f = await foundation();
    const selected = Object.values(f.binding.settings.roles)[0]!;
    const evaluation = {
      kind: 'llm',
      harness: 'codex',
      question: 'Ready?',
      model: { mode: 'explicit', value: selected.model },
      effort: { mode: 'explicit', value: selected.effort },
    };
    const answer = {
      type: 'noul',
      true: { id: 'yes', label: 'Yes', criteria: 'Ready' },
      false: { id: 'no', label: 'No', criteria: 'Not ready' },
    };
    const definition = LoopDefinitionSchema.parse({
      ...f.pinned.definition,
      settings: {
        ...f.pinned.definition.settings,
        defaults: { byHarness: { codex: { model: selected.model, effort: selected.effort } } },
      },
      nodes: [
        { id: 'decide', kind: 'decision', label: 'Decide', config: { answer, evaluation } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {
            default: 'success',
            criteria: [
              {
                when: 'predicate',
                answer: {
                  type: 'noul',
                  true: { label: 'Yes', criteria: 'Ready' },
                  false: { label: 'No', criteria: 'Not ready' },
                },
                evaluation: {
                  ...evaluation,
                  model: { mode: 'inherit' },
                  effort: { mode: 'inherit' },
                },
                match: { type: 'noul', value: true },
                outcome: 'success',
              },
            ],
          },
        },
      ],
      edges: [],
    });
    expect(
      await f.prerequisites.checkCurrentRoles('local', definition, 'actual-roles'),
    ).toMatchObject({ canRun: true });
    f.harness.preflightResult.authenticated = false;
    expect(
      await f.prerequisites.checkCurrentRoles('local', definition, 'actual-roles'),
    ).toMatchObject({ canRun: false });
    expect(f.harness.started).toHaveLength(0);
  });
  it('refuses missing capability models and harness exceptions despite an enabled model catalog', async () => {
    const f = await foundation();
    f.harness.preflightResult.models = [];
    expect(
      await f.prerequisites.check('local', f.binding.manifest, f.binding.settings),
    ).toMatchObject({ canInstantiate: false });
    f.harness.preflight = () => Promise.reject(new Error('synthetic unavailable account'));
    const report = await f.prerequisites.check('local', f.binding.manifest, f.binding.settings);
    expect(report).toMatchObject({ canInstantiate: false, canRun: false });
    expect(JSON.stringify(report)).not.toContain('synthetic unavailable account');
    const noHarness = new TemplatePrerequisites({
      catalog: f.catalog,
      harnesses: {},
      scripts: {
        run: () => {
          throw new Error('no subprocess');
        },
      },
      apiKeys: f.apiKeys,
      secretsFor: () => f.secrets,
      supportAvailable: () => Promise.resolve(false),
    });
    expect(await noHarness.check('local', f.binding.manifest, f.binding.settings)).toMatchObject({
      canRun: false,
    });
  });
});

describe('actual poll support callsite', () => {
  it('passes trusted published owner/loop/version/node identity into the private decorator before any run', async () => {
    const f = await foundation('implementation', 'poll', true);
    const { SqliteLoopRepository } = await import('@graphgoblin/infrastructure/sqlite');
    const { FakeProbes, CapturingLogger } = await import('@graphgoblin/engine/testing');
    const { PollTriggers } = await import('../triggers/poll.js');
    const clock = new FakeClock();
    const loops = new SqliteLoopRepository(f.handle.db, clock, { next: () => fakeUlid('unused') });
    const version = await loops.publish(f.pinned.loopId);
    const loop = await loops.getLoop(f.pinned.loopId);
    if (!loop || !version) throw new Error('missing published poll fixture');
    const log = new CapturingLogger();
    const polls = new PollTriggers({
      probes: new FakeProbes(),
      scripts: f.scripts,
      manager: {
        startRun: () => {
          throw new Error('fireWhen false must never start');
        },
        startPollItem: () => {
          throw new Error('no fanout');
        },
      },
      hasDedupe: () => Promise.resolve(false),
      findSeen: () => Promise.resolve(new Set<string>()),
      clock,
      logger: log,
      scriptCwd: 'untrusted-default-cwd',
    });
    polls.arm(loop, version);
    clock.advance(30_000);
    expect(await polls.poll()).toEqual([]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.cwd).toBe(f.root);
    expect(f.requests[0]?.command).toBe(process.execPath);
    expect(JSON.parse(f.requests[0]!.stdin!).credential === f.key.token).toBe(true);
    expect(log.lines).toEqual([]);
    expect(f.harness.started).toHaveLength(0);
  });
});

describe('QA admission owns a permanent issue attempt across merge SHAs', () => {
  it('allows one winner across concurrent instances and rejects a later merge after termination and runtime reconstruction', async () => {
    const f = await foundation();
    const first = await recipe(f, 'qa', ['qa-rework']);
    const second = await recipe(f, 'qa', ['qa-rework']);
    const buildAdmission = (mergeSha: string, issue = 7) => {
      const source: TemplateAuthoritySource = {
        resolve: () =>
          Promise.resolve({
            kind: 'qa',
            repository: 'example/project',
            issue,
            attempt: 1,
            source: { kind: 'external' },
            pullRequest: 12,
            mergeSha,
          }),
        recheck: () => Promise.resolve(),
      };
      const runtime = new TemplateRuntime(f.instances, source);
      return templateAdmission(
        new SqliteTriggerAdmission(f.handle.db, f.events, (store, input, poll) =>
          runtime.afterRunStaged(store, input, poll),
        ),
        runtime,
      );
    };
    const a = recipeIntent(first, 'qa-race-a');
    const b = recipeIntent(second, 'qa-race-b');
    const outcomes = await Promise.allSettled([
      buildAdmission('a'.repeat(40)).create(a),
      buildAdmission('b'.repeat(40)).create(b),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'TEMPLATE_SUBJECT_CONSUMED' } });
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('missing winner');
    await f.runs.update(winner.value.id, { status: 'failed' });
    const later = recipeIntent(second, 'qa-later-merge');
    await expect(buildAdmission('c'.repeat(40)).create(later)).rejects.toMatchObject({
      code: 'TEMPLATE_SUBJECT_CONSUMED',
    });
    expect(await f.runs.get(later.run.id)).toBeUndefined();
    expect(await f.events.read(later.run.id)).toEqual([]);
    const otherIssue = recipeIntent(second, 'qa-independent-issue');
    expect((await buildAdmission('d'.repeat(40), 8).create(otherIssue)).id).toBe(otherIssue.run.id);
    expect(f.requests).toHaveLength(0);
    expect(f.harness.started).toHaveLength(0);
  });
});
