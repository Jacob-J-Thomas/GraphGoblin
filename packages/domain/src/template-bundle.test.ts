import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  SubloopConfigSchema,
  TemplateBundleSchema,
  type TemplateBundle,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import {
  prepareTemplateBundle,
  validateTemplateBundle,
  TemplateBundleError,
  type TemplateLoopAllocation,
} from './template-bundle.js';

const role = { harness: 'codex', model: 'chosen-model', effort: 'high' } as const;
const settings = {
  kind: 'starter',
  instruction: 'Literal {{never-render-this}}; $(never-run-this)',
  maxIterations: 12,
  roles: { assistant: role },
};
function definition() {
  return LoopDefinitionSchema.parse({
    schemaVersion: 3,
    name: 'Authored',
    nodes: [
      { id: 'start', label: 'Start', kind: 'trigger', config: { subtype: 'manual' } },
      {
        id: 'settings',
        label: 'Settings',
        kind: 'mutate',
        config: {
          operations: [
            { op: 'set', path: '/vars/templateSettings', value: { kind: 'literal', value: {} } },
          ],
        },
      },
      {
        id: 'work',
        label: 'Work',
        kind: 'inference',
        config: { prompt: { template: '{{ vars.templateSettings.instruction }}' } },
      },
      { id: 'done', label: 'Done', kind: 'exit', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'settings' } },
      { id: 'b', from: { node: 'settings', port: 'out' }, to: { node: 'work' } },
      { id: 'c', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  });
}
function bundle(): TemplateBundle {
  return TemplateBundleSchema.parse({
    manifest: {
      id: 'starter',
      version: '1.0.0',
      kind: 'starter',
      title: 'Assistant',
      description: 'Manual assistant',
      parentKey: 'main',
      roles: [{ id: 'assistant', label: 'Assistant', access: 'read-only' }],
      loops: [
        {
          key: 'main',
          file: 'main.json',
          roleNodes: [{ role: 'assistant', nodeId: 'work' }],
          settingsNodes: ['settings'],
        },
      ],
    },
    loops: { main: definition() },
  });
}
function splitBundle(): TemplateBundle {
  const value = bundle();
  const parent = value.loops.main!;
  parent.nodes = parent.nodes.map((node) =>
    node.id === 'work'
      ? {
          ...node,
          kind: 'subloop',
          config: SubloopConfigSchema.parse({
            loopRef: { loopId: fakeUlid('placeholder'), version: 'latest' },
            input: { mode: 'inherit' },
            output: { mode: 'result-only' },
          }),
        }
      : node,
  );
  value.manifest.loops[0]!.roleNodes = [];
  value.manifest.loops[0]!.dependsOn = ['child'];
  value.manifest.loops[0]!.subloops = [{ nodeId: 'work', loopKey: 'child' }];
  value.manifest.loops.push({
    key: 'child',
    file: 'child.json',
    dependsOn: [],
    roleNodes: [{ role: 'assistant', nodeId: 'work' }],
    settingsNodes: ['settings'],
    subloops: [],
  });
  value.loops.child = definition();
  return value;
}
function allocations(keys = ['main']): Record<string, TemplateLoopAllocation> {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        loopId: fakeUlid(`loop-${key}`),
        versionId: fakeUlid(`version-${key}`),
        version: 2,
        name: `Assistant ${key}`,
      },
    ]),
  );
}
type BrokenCase = [string, (input: TemplateBundle) => void];

describe('bundle preparation', () => {
  it('applies the implementation visit limit to every immutable loop without changing source', () => {
    const authored = splitBundle();
    authored.manifest.kind = 'implementation';
    authored.manifest.roles = [{ id: 'implementer', label: 'Implementer', access: 'write' }];
    authored.manifest.requiredSecrets = [{ key: 'supportReadKey', scopes: ['runs:read'] }];
    for (const loop of authored.manifest.loops)
      loop.roleNodes = loop.roleNodes.map((mapping) => ({ ...mapping, role: 'implementer' }));
    const original = structuredClone(authored);
    const prepared = prepareTemplateBundle(
      authored,
      {
        kind: 'implementation',
        repository: { path: 'C:/fixture/repo', owner: 'Fixture', name: 'repo', baseBranch: 'main' },
        supportReadKey: 'reader',
        roles: { implementer: role },
        limits: { maxIterations: 3 },
      },
      allocations(['main', 'child']),
    );
    expect(prepared.loops.map((loop) => loop.definition.settings.maxIterations)).toEqual([3, 3]);
    expect(prepared.settings).toMatchObject({
      limits: { maxTasks: 8, gateFixes: 2, maxIterations: 3 },
    });
    expect(authored).toEqual(original);
  });
  it('copies settings as JSON and explicit role fields without editing authored source', () => {
    const authored = bundle();
    const original = structuredClone(authored);
    const prepared = prepareTemplateBundle(authored, settings, allocations());
    const loop = prepared.loops[0]!;
    expect(loop.status).toBe('draft');
    expect(loop.definition.name).toBe('Assistant main');
    expect(loop.definition.settings.maxIterations).toBe(12);
    const mutate = loop.definition.nodes.find((node) => node.kind === 'mutate');
    expect(mutate?.config.operations).toEqual([
      { op: 'set', path: '/vars/templateSettings', value: { kind: 'literal', value: settings } },
    ]);
    const inference = loop.definition.nodes.find((node) => node.kind === 'inference');
    expect(inference?.config).toMatchObject({
      harness: 'codex',
      model: 'chosen-model',
      effort: 'high',
      session: { policy: 'fresh' },
      harnessOptions: { sandbox: 'read-only', networkAccess: false, webSearch: false },
      prompt: { template: '{{ vars.templateSettings.instruction }}' },
    });
    expect(authored).toEqual(original);
    expect(prepared.settings).not.toBe(settings);
  });
  it('prepares children before the draft parent and pins exact owner-allocated versions', () => {
    const authored = splitBundle();
    const ids = allocations(['main', 'child']);
    const result = prepareTemplateBundle(authored, settings, ids);
    expect(result.loops.map((loop) => [loop.key, loop.status])).toEqual([
      ['child', 'published'],
      ['main', 'draft'],
    ]);
    expect(result.parentLoopId).toBe(ids.main!.loopId);
    const node = result.loops[1]!.definition.nodes.find(
      (candidate) => candidate.kind === 'subloop',
    );
    expect(node?.config.loopRef).toEqual({
      loopId: ids.child!.loopId,
      version: ids.child!.version,
    });
    const second = prepareTemplateBundle(authored, settings, {
      main: { ...ids.main!, loopId: fakeUlid('second-parent'), name: 'Second parent' },
      child: { ...ids.child!, loopId: fakeUlid('second-child'), name: 'Second child' },
    });
    expect(second.parentLoopId).not.toBe(result.parentLoopId);
  });
  it.each(['codex', 'claude'] as const)(
    'applies write roles with the %s native option shape',
    (harness) => {
      const authored = bundle();
      authored.manifest.roles[0]!.access = 'write';
      const result = prepareTemplateBundle(
        authored,
        { ...settings, roles: { assistant: { ...role, harness } } },
        allocations(),
      );
      const inference = result.loops[0]!.definition.nodes.find((node) => node.kind === 'inference');
      expect(inference?.config.harnessOptions.sandbox).toBe(
        harness === 'codex' ? 'workspace-write' : 'danger-full-access',
      );
      expect(inference?.config.session).toEqual({ policy: 'fresh' });
    },
  );
  it('prepares a shared child once in a dependency diamond', () => {
    const authored = splitBundle();
    authored.loops.left = structuredClone(authored.loops.main!);
    authored.loops.right = structuredClone(authored.loops.main!);
    const middle = authored.manifest.loops[0]!;
    authored.manifest.loops.push(
      { ...structuredClone(middle), key: 'left', file: 'left.json' },
      { ...structuredClone(middle), key: 'right', file: 'right.json' },
    );
    const first = authored.loops.main!.nodes.find((node) => node.kind === 'subloop')!;
    authored.loops.main!.nodes.push({ ...structuredClone(first), id: 'second' });
    authored.loops.main!.edges.find((edge) => edge.id === 'c')!.to.node = 'second';
    authored.loops.main!.edges.push({
      id: 'd',
      from: { node: 'second', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    middle.dependsOn = ['left', 'right'];
    middle.subloops = [
      { nodeId: 'work', loopKey: 'left' },
      { nodeId: 'second', loopKey: 'right' },
    ];
    const prepared = prepareTemplateBundle(
      authored,
      settings,
      allocations(['main', 'child', 'left', 'right']),
    );
    expect(prepared.loops.map((loop) => loop.key)).toEqual(['child', 'left', 'right', 'main']);
    expect(prepared.loops.filter((loop) => loop.key === 'child')).toHaveLength(1);
  });
  it('refuses authored capabilities unsupported by the selected native harness', () => {
    const authored = bundle();
    authored.loops.main!.nodes.find((node) => node.kind === 'inference')!.config.capabilities = {
      mcpServers: ['custom'],
    };
    expect(() =>
      prepareTemplateBundle(
        authored,
        { ...settings, roles: { assistant: { ...role, harness: 'claude' } } },
        allocations(),
      ),
    ).toThrow('prepared loop main is invalid');
  });
  it('addresses the required supportReadKey settings field without a second secret map', () => {
    const authored = bundle();
    authored.manifest.kind = 'implementation';
    authored.manifest.roles[0]!.id = 'implementer';
    authored.manifest.loops[0]!.roleNodes[0]!.role = 'implementer';
    authored.manifest.requiredSecrets = [{ key: 'supportReadKey', scopes: ['runs:read'] }];
    authored.manifest.prerequisites = [
      {
        id: 'support-read-key',
        kind: 'secret',
        secretKey: 'supportReadKey',
        label: 'Reader key',
        blocking: 'authoring',
      },
    ];
    const result = prepareTemplateBundle(
      authored,
      {
        kind: 'implementation',
        repository: { path: '/repos/example', owner: 'owner', name: 'example', baseBranch: 'main' },
        supportReadKey: 'reader-key',
        roles: { implementer: role },
      },
      allocations(),
    );
    expect(result.settings.kind).toBe('implementation');
    expect(result.loops[0]?.definition.settings.maxIterations).toBe(100);
    authored.manifest.requiredSecrets.push({ key: 'missingKey', scopes: ['runs:read'] });
    expect(() => prepareTemplateBundle(authored, result.settings, allocations())).toThrow(
      'required secret reference',
    );
  });
});

describe('bundle integrity refusal before persistence', () => {
  it('rejects old format/unknown schema fields', () => {
    expect(() => validateTemplateBundle({ ...bundle(), surprise: true })).toThrow(
      TemplateBundleError,
    );
    const authored = bundle();
    expect(() =>
      validateTemplateBundle({
        ...authored,
        loops: { main: { ...authored.loops.main, schemaVersion: 2 } },
      }),
    ).toThrow('schema');
  });
  const broken: BrokenCase[] = [
    ['loop keys', (v) => v.manifest.loops.push(v.manifest.loops[0]!)],
    ['role ids', (v) => v.manifest.roles.push(v.manifest.roles[0]!)],
    [
      'prerequisite ids',
      (v) =>
        (v.manifest.prerequisites = [
          { id: 'model', label: 'Model', kind: 'role', role: 'assistant', blocking: 'authoring' },
          { id: 'model', label: 'Model', kind: 'role', role: 'assistant', blocking: 'authoring' },
        ]),
    ],
    [
      'secret keys',
      (v) =>
        (v.manifest.requiredSecrets = [
          { key: 'key', scopes: ['runs:read'] },
          { key: 'key', scopes: ['runs:read'] },
        ]),
    ],
    ['parent key', (v) => (v.manifest.parentKey = 'missing')],
    ['exactly match', (v) => delete v.loops.main],
    [
      'role prerequisite',
      (v) =>
        (v.manifest.prerequisites = [
          { id: 'model', label: 'Model', kind: 'role', blocking: 'authoring' },
        ]),
    ],
    [
      'role prerequisite',
      (v) =>
        (v.manifest.prerequisites = [
          { id: 'model', label: 'Model', kind: 'role', role: 'fixer', blocking: 'authoring' },
        ]),
    ],
    [
      'secret prerequisite',
      (v) =>
        (v.manifest.prerequisites = [
          { id: 'key', label: 'Key', kind: 'secret', blocking: 'authoring' },
        ]),
    ],
    [
      'secret prerequisite',
      (v) =>
        (v.manifest.prerequisites = [
          { id: 'key', label: 'Key', kind: 'secret', secretKey: 'absent', blocking: 'authoring' },
        ]),
    ],
    [
      'role node ids',
      (v) => v.manifest.loops[0]!.roleNodes.push(v.manifest.loops[0]!.roleNodes[0]!),
    ],
    ['settings node ids', (v) => v.manifest.loops[0]!.settingsNodes.push('settings')],
    ['dependency key', (v) => (v.manifest.loops[0]!.dependsOn = ['missing'])],
    ['undeclared role', (v) => (v.manifest.loops[0]!.roleNodes[0]!.role = 'fixer')],
    ['inference node', (v) => (v.manifest.loops[0]!.roleNodes[0]!.nodeId = 'start')],
    ['explicit role', (v) => (v.manifest.loops[0]!.roleNodes = [])],
    ['single literal', (v) => (v.manifest.loops[0]!.settingsNodes = ['start'])],
    [
      'every declared role',
      (v) => v.manifest.roles.push({ id: 'fixer', label: 'Unused', access: 'write' }),
    ],
    ['invalid', (v) => (v.loops.main!.edges[0]!.to.node = 'absent')],
    [
      'invalid',
      (v) => {
        const node = v.loops.main!.nodes.find((n) => n.kind === 'inference')!;
        node.config.prompt.template = '{% unclosed';
      },
    ],
  ];
  it.each(broken)('rejects %s', (message, breakIt) => {
    const authored = bundle();
    breakIt(authored);
    expect(() => validateTemplateBundle(authored)).toThrow(message);
  });
  const brokenChildren: BrokenCase[] = [
    ['dependency keys', (v) => v.manifest.loops[0]!.dependsOn.push('child')],
    [
      'subloop node ids',
      (v) => v.manifest.loops[0]!.subloops.push(v.manifest.loops[0]!.subloops[0]!),
    ],
    [
      'manual triggers',
      (v) => {
        const node = v.loops.child!.nodes.find((n) => n.kind === 'trigger')!;
        node.config = { subtype: 'event', eventType: 'example' };
      },
    ],
    ['declared dependency', (v) => (v.manifest.loops[0]!.subloops[0]!.loopKey = 'main')],
    ['subloop node', (v) => (v.manifest.loops[0]!.subloops[0]!.nodeId = 'start')],
    ['must be mapped', (v) => (v.manifest.loops[0]!.subloops = [])],
    [
      'every dependency',
      (v) => {
        v.manifest.loops[0]!.subloops = [];
        const work = definition().nodes.find((n) => n.kind === 'inference')!;
        v.loops.main!.nodes = v.loops.main!.nodes.map((n) => (n.id === 'work' ? work : n));
        v.manifest.loops[0]!.roleNodes = [{ role: 'assistant', nodeId: 'work' }];
      },
    ],
    [
      'cycle',
      (v) => {
        v.loops.child = structuredClone(v.loops.main!);
        v.manifest.loops[1]!.roleNodes = [];
        v.manifest.loops[1]!.dependsOn = ['main'];
        v.manifest.loops[1]!.subloops = [{ nodeId: 'work', loopKey: 'main' }];
        v.manifest.roles = [];
      },
    ],
    [
      'orphan',
      (v) => {
        v.manifest.loops.push({ ...v.manifest.loops[1]!, key: 'orphan', file: 'orphan.json' });
        v.loops.orphan = definition();
      },
    ],
  ];
  it.each(brokenChildren)('rejects child %s', (message, breakIt) => {
    const authored = splitBundle();
    breakIt(authored);
    expect(() => validateTemplateBundle(authored)).toThrow(message);
  });
  it.each(['template', 'expression'] as const)(
    'refuses executable %s settings substitution',
    (kind) => {
      const authored = bundle();
      const node = authored.loops.main!.nodes.find((n) => n.kind === 'mutate')!;
      node.config.operations = [
        {
          op: 'set',
          path: '/vars/templateSettings',
          value:
            kind === 'template' ? { kind, template: '{{ vars.x }}' } : { kind, jsonata: 'vars.x' },
        },
      ];
      expect(() => validateTemplateBundle(authored)).toThrow('single literal');
    },
  );
  it('rejects the wrong literal target and additional mutation operations', () => {
    const authored = bundle();
    const node = authored.loops.main!.nodes.find((n) => n.kind === 'mutate')!;
    node.config.operations = [
      { op: 'set', path: '/vars/other', value: { kind: 'literal', value: {} } },
    ];
    expect(() => validateTemplateBundle(authored)).toThrow('single literal');
    node.config.operations.push({ op: 'delete', path: '/vars/x' });
    expect(() => validateTemplateBundle(authored)).toThrow('single literal');
  });
  it('validates allocations and settings before preparing any definitions', () => {
    const authored = bundle();
    expect(() =>
      prepareTemplateBundle(authored, { ...settings, bad: true }, allocations()),
    ).toThrow('settings are invalid');
    expect(() =>
      prepareTemplateBundle(
        authored,
        {
          kind: 'review',
          repository: { path: '/repo', owner: 'owner', name: 'repo', baseBranch: 'main' },
          supportReadKey: 'reader',
          roles: { reviewer: role, fixer: role },
        },
        allocations(),
      ),
    ).toThrow('settings kind');
    expect(() => prepareTemplateBundle(authored, settings, {})).toThrow('allocations');
    expect(() =>
      prepareTemplateBundle(authored, settings, {
        main: { ...allocations().main!, loopId: 'not-ulid' },
      }),
    ).toThrow('allocation needs');
    expect(() =>
      prepareTemplateBundle(authored, settings, { main: { ...allocations().main!, name: ' ' } }),
    ).toThrow('allocation needs');
    authored.manifest.roles[0]!.id = 'implementer';
    authored.manifest.loops[0]!.roleNodes[0]!.role = 'implementer';
    expect(() => prepareTemplateBundle(authored, settings, allocations())).toThrow(
      'settings roles',
    );
  });
  it.each(['loopId', 'versionId', 'name'] as const)('refuses duplicate allocated %s', (key) => {
    const ids = allocations(['main', 'child']);
    ids.child = { ...ids.child!, [key]: ids.main![key] };
    expect(() => prepareTemplateBundle(splitBundle(), settings, ids)).toThrow('must be unique');
  });
});
