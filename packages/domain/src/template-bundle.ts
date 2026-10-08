import {
  JsonValueSchema,
  LoopDefinitionSchema,
  TemplateBundleSchema,
  TemplateSettingsSchema,
  UlidSchema,
  type LoopDefinition,
  type Node,
  type TemplateBundle,
  type TemplateRoleSelection,
  type TemplateSettings,
} from '@graphgoblin/contracts';
import { DomainError } from './errors.js';
import { validateLoop } from './graph.js';

export class TemplateBundleError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('TEMPLATE_INVALID_BUNDLE', message, details);
  }
}
export interface TemplateLoopAllocation {
  loopId: string;
  versionId: string;
  version: number;
  name: string;
}
export interface PreparedTemplateLoop extends TemplateLoopAllocation {
  key: string;
  status: 'draft' | 'published';
  definition: LoopDefinition;
}
export interface PreparedTemplateBundle {
  manifest: TemplateBundle['manifest'];
  settings: TemplateSettings;
  parentLoopId: string;
  loops: PreparedTemplateLoop[];
}

function requireIntegrity(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TemplateBundleError(message);
}
function unique(values: readonly string[], label: string): void {
  requireIntegrity(new Set(values).size === values.length, `${label} must be unique`);
}

/** Validate authored data and the complete child graph before the API writes any loops. */
export function validateTemplateBundle(input: unknown): {
  bundle: TemplateBundle;
  order: string[];
} {
  const parsed = TemplateBundleSchema.safeParse(input);
  if (!parsed.success)
    throw new TemplateBundleError('template bundle schema is invalid', parsed.error.issues);
  const bundle = parsed.data;
  const { manifest } = bundle;
  const keys = manifest.loops.map((loop) => loop.key);
  unique(keys, 'loop keys');
  unique(
    manifest.roles.map((role) => role.id),
    'role ids',
  );
  unique(
    manifest.prerequisites.map((check) => check.id),
    'prerequisite ids',
  );
  unique(
    manifest.requiredSecrets.map((secret) => secret.key),
    'secret keys',
  );
  requireIntegrity(keys.includes(manifest.parentKey), 'parent key is missing');
  requireIntegrity(
    Object.keys(bundle.loops).length === keys.length &&
      keys.every((key) => Object.hasOwn(bundle.loops, key)),
    'bundle definitions must exactly match manifest loop keys',
  );
  const roles = new Set(manifest.roles.map((role) => role.id));
  const secrets = new Set(manifest.requiredSecrets.map((secret) => secret.key));
  const usedRoles = new Set<string>();
  for (const prerequisite of manifest.prerequisites) {
    requireIntegrity(
      prerequisite.kind !== 'role' ||
        (prerequisite.role !== undefined && roles.has(prerequisite.role)),
      'role prerequisite must refer to a declared role',
    );
    requireIntegrity(
      prerequisite.kind !== 'secret' ||
        (prerequisite.secretKey !== undefined && secrets.has(prerequisite.secretKey)),
      'secret prerequisite must refer to a declared secret',
    );
  }
  for (const loop of manifest.loops) {
    const definition = bundle.loops[loop.key]!;
    unique(loop.dependsOn, 'dependency keys');
    unique(
      loop.roleNodes.map((role) => role.nodeId),
      'role node ids',
    );
    unique(loop.settingsNodes, 'settings node ids');
    unique(
      loop.subloops.map((child) => child.nodeId),
      'subloop node ids',
    );
    requireIntegrity(
      loop.dependsOn.every((key) => keys.includes(key)),
      'dependency key is missing',
    );
    const graphErrors = validateLoop(definition).filter((issue) => issue.severity === 'error');
    if (graphErrors.length)
      throw new TemplateBundleError(`loop ${loop.key} is invalid`, graphErrors);
    if (loop.key !== manifest.parentKey)
      requireIntegrity(
        definition.nodes.every(
          (node) => node.kind !== 'trigger' || node.config.subtype === 'manual',
        ),
        'children must use manual triggers',
      );
    for (const mapping of loop.roleNodes) {
      requireIntegrity(roles.has(mapping.role), 'role mapping refers to an undeclared role');
      requireIntegrity(
        definition.nodes.some((node) => node.id === mapping.nodeId && node.kind === 'inference'),
        'role mapping must name an inference node',
      );
      usedRoles.add(mapping.role);
    }
    requireIntegrity(
      definition.nodes
        .filter((node) => node.kind === 'inference')
        .every((node) => loop.roleNodes.some((mapping) => mapping.nodeId === node.id)),
      'every inference node needs an explicit role',
    );
    for (const id of loop.settingsNodes) {
      const node = definition.nodes.find((candidate) => candidate.id === id);
      requireIntegrity(
        node?.kind === 'mutate' &&
          node.config.operations.length === 1 &&
          node.config.operations[0]?.op === 'set' &&
          node.config.operations[0].path === '/vars/templateSettings' &&
          node.config.operations[0].value.kind === 'literal',
        'settings node must be a single literal set at /vars/templateSettings',
      );
    }
    for (const mapping of loop.subloops) {
      requireIntegrity(
        loop.dependsOn.includes(mapping.loopKey),
        'subloop target must be a declared dependency',
      );
      requireIntegrity(
        definition.nodes.some((node) => node.id === mapping.nodeId && node.kind === 'subloop'),
        'subloop mapping must name a subloop node',
      );
    }
    requireIntegrity(
      definition.nodes
        .filter((node) => node.kind === 'subloop')
        .every((node) => loop.subloops.some((mapping) => mapping.nodeId === node.id)),
      'every subloop must be mapped into the bundle',
    );
    requireIntegrity(
      loop.dependsOn.every((key) => loop.subloops.some((mapping) => mapping.loopKey === key)),
      'every dependency must be used by a mapped subloop',
    );
  }
  requireIntegrity(
    manifest.roles.every((role) => usedRoles.has(role.id)),
    'every declared role must be used',
  );
  const visited = new Set<string>();
  const open = new Set<string>();
  const order: string[] = [];
  function visit(key: string): void {
    requireIntegrity(!open.has(key), 'bundle dependencies must not contain a cycle');
    if (visited.has(key)) return;
    open.add(key);
    for (const dependency of manifest.loops.find((loop) => loop.key === key)!.dependsOn)
      visit(dependency);
    open.delete(key);
    visited.add(key);
    order.push(key);
  }
  visit(manifest.parentKey);
  requireIntegrity(visited.size === keys.length, 'bundle contains an orphan loop');
  return { bundle, order };
}

/** Settings are JSON data. Only literal data slots and explicit role/id fields change. */
export function prepareTemplateBundle(
  input: unknown,
  settingsInput: unknown,
  allocations: Readonly<Record<string, TemplateLoopAllocation>>,
): PreparedTemplateBundle {
  const { bundle, order } = validateTemplateBundle(input);
  const parsed = TemplateSettingsSchema.safeParse(settingsInput);
  if (!parsed.success)
    throw new TemplateBundleError('template settings are invalid', parsed.error.issues);
  const settings = parsed.data;
  requireIntegrity(settings.kind === bundle.manifest.kind, 'settings kind does not match template');
  requireIntegrity(
    Object.keys(allocations).length === order.length &&
      order.every((key) => Object.hasOwn(allocations, key)),
    'allocations must exactly match bundle keys',
  );
  unique(
    order.map((key) => allocations[key]!.loopId),
    'allocated loop ids',
  );
  unique(
    order.map((key) => allocations[key]!.versionId),
    'allocated version ids',
  );
  unique(
    order.map((key) => allocations[key]!.name),
    'allocated names',
  );
  for (const key of order) {
    const allocation = allocations[key]!;
    requireIntegrity(
      UlidSchema.safeParse(allocation.loopId).success &&
        UlidSchema.safeParse(allocation.versionId).success &&
        Number.isInteger(allocation.version) &&
        allocation.version > 0 &&
        allocation.name.length > 0 &&
        allocation.name.length <= 120 &&
        allocation.name.trim().length > 0,
      'allocation needs valid owner-allocated ids, version and name',
    );
  }
  const selections: Record<string, TemplateRoleSelection> = settings.roles;
  const roleIds = bundle.manifest.roles.map((role) => role.id);
  requireIntegrity(
    Object.keys(selections).length === roleIds.length &&
      roleIds.every((id) => Object.hasOwn(selections, id)),
    'settings roles must exactly match declared roles',
  );
  const settingsRecord = settings as unknown as Record<string, unknown>;
  requireIntegrity(
    bundle.manifest.requiredSecrets.every(
      (secret) => typeof settingsRecord[secret.key] === 'string',
    ),
    'required secret reference is missing from settings',
  );
  const loops = order.map((key): PreparedTemplateLoop => {
    const descriptor = bundle.manifest.loops.find((loop) => loop.key === key)!;
    const definition = LoopDefinitionSchema.parse(bundle.loops[key]);
    definition.name = allocations[key]!.name;
    if ('maxIterations' in settings) definition.settings.maxIterations = settings.maxIterations;
    else if (settings.kind === 'implementation')
      definition.settings.maxIterations = settings.limits.maxIterations;
    for (const mapping of descriptor.roleNodes) {
      const node = definition.nodes.find(
        (candidate): candidate is Extract<Node, { kind: 'inference' }> =>
          candidate.id === mapping.nodeId && candidate.kind === 'inference',
      )!;
      const selection = selections[mapping.role]!;
      const access = bundle.manifest.roles.find((role) => role.id === mapping.role)!.access;
      node.config.harness = selection.harness;
      node.config.model = selection.model;
      node.config.effort = selection.effort;
      node.config.session = { policy: 'fresh' };
      node.config.harnessOptions = {
        sandbox:
          access === 'read-only'
            ? 'read-only'
            : selection.harness === 'claude'
              ? 'danger-full-access'
              : 'workspace-write',
        approval: 'never',
        ...(selection.harness === 'codex' ? { networkAccess: false } : {}),
        webSearch: false,
      };
    }
    for (const id of descriptor.settingsNodes) {
      const node = definition.nodes.find(
        (candidate): candidate is Extract<Node, { kind: 'mutate' }> =>
          candidate.id === id && candidate.kind === 'mutate',
      )!;
      node.config.operations[0] = {
        op: 'set',
        path: '/vars/templateSettings',
        value: {
          kind: 'literal',
          value: JsonValueSchema.parse(JSON.parse(JSON.stringify(settings))),
        },
      };
    }
    for (const mapping of descriptor.subloops) {
      const node = definition.nodes.find(
        (candidate): candidate is Extract<Node, { kind: 'subloop' }> =>
          candidate.id === mapping.nodeId && candidate.kind === 'subloop',
      )!;
      const allocation = allocations[mapping.loopKey]!;
      node.config.loopRef = { loopId: allocation.loopId, version: allocation.version };
    }
    const checked = LoopDefinitionSchema.safeParse(definition);
    if (!checked.success)
      throw new TemplateBundleError(`prepared loop ${key} is invalid`, checked.error.issues);
    return {
      ...allocations[key]!,
      key,
      status: key === bundle.manifest.parentKey ? 'draft' : 'published',
      definition: checked.data,
    };
  });
  return {
    manifest: bundle.manifest,
    settings,
    parentLoopId: allocations[bundle.manifest.parentKey]!.loopId,
    loops,
  };
}
