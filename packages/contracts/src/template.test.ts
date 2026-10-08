import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fakeUlid, FIXTURE_TS } from './testing/index.js';
import {
  ImplementationTemplateSettingsSchema,
  QaTemplateSettingsSchema,
  ReviewTemplateSettingsSchema,
  StarterTemplateSettingsSchema,
  TemplateGateSchema,
  TemplateRepositorySchema,
  TemplateSettingsSchema,
} from './template-settings.js';
import {
  TemplateCatalogEntrySchema,
  TemplateInstantiateRequestSchema,
  TemplateInstantiateResponseSchema,
  TemplateInstanceSchema,
  TemplateListResponseSchema,
  TemplateManifestSchema,
  TemplatePrerequisiteReportSchema,
  TemplatePrerequisiteRequestSchema,
} from './template-manifest.js';

const role = { harness: 'codex', model: 'catalog-model', effort: 'high' } as const;
const starter = { kind: 'starter', roles: { assistant: role } };
const repository = {
  path: 'C:/repos/example',
  owner: 'owner',
  name: 'example',
  baseBranch: 'main',
};
const common = { repository, supportReadKey: 'support-reader' };
const manifest = {
  id: 'starter',
  version: '1.0.0',
  kind: 'starter',
  title: 'Starter',
  description: 'A manual assistant.',
  roles: [{ id: 'assistant', label: 'Assistant', access: 'read-only' }],
  parentKey: 'main',
  loops: [{ key: 'main', file: 'main.json' }],
};
const report = { checks: [], canInstantiate: true, canRun: true };
const parent = {
  key: 'main',
  loopId: fakeUlid('parent'),
  versionId: fakeUlid('parent-version'),
  version: 1,
  status: 'draft',
};
const child = {
  key: 'child',
  loopId: fakeUlid('child'),
  versionId: fakeUlid('child-version'),
  version: 2,
  status: 'published',
};
const instance = {
  id: fakeUlid('instance'),
  ownerId: 'owner',
  templateId: 'starter',
  templateVersion: '1.0.0',
  createdAt: FIXTURE_TS,
  parentLoopId: parent.loopId,
  loops: [child, parent],
  settings: starter,
};

describe('template typed settings', () => {
  it('provides a starter with data-only instructions and actual selected role', () => {
    const value = StarterTemplateSettingsSchema.parse(starter);
    expect(value.instruction).toContain('Summarize');
    expect(value.maxIterations).toBe(10);
    expect(value.roles.assistant).toEqual(role);
    const schema = z.toJSONSchema(StarterTemplateSettingsSchema, { io: 'input' });
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { const: 'starter' },
        instruction: { type: 'string', maxLength: 4000 },
        roles: { type: 'object' },
      },
    });
  });
  it('retains repository lifecycle caps and explicit CI none', () => {
    const implementation = ImplementationTemplateSettingsSchema.parse({
      kind: 'implementation',
      ...common,
      roles: { implementer: role },
    });
    expect(implementation.labels.trigger).toBe('ready-for-implementation');
    expect(implementation.gate).toEqual({ program: 'pnpm', args: ['check'], timeoutSeconds: 600 });
    expect(implementation.limits.maxTasks).toBe(8);
    const review = ReviewTemplateSettingsSchema.parse({
      kind: 'review',
      ...common,
      roles: { reviewer: role, fixer: role },
      requiredChecks: { source: 'explicit', names: [] },
    });
    expect(review.requiredChecks).toEqual({ source: 'explicit', names: [] });
    expect(review.limits).toMatchObject({
      automaticCycles: 3,
      extraCycles: 3,
      reminders: 3,
      waitHours: 24,
    });
    const qa = QaTemplateSettingsSchema.parse({
      kind: 'qa',
      ...common,
      roles: { qa: role, adversary: role },
    });
    expect(qa.limits).toEqual({
      unsoundReruns: 1,
      reworkRequests: 2,
      reopenings: 2,
      proofPushRetries: 3,
    });
  });
  it.each([
    { ...starter, surprise: true },
    { ...starter, roles: { assistant: { ...role, token: 'secret' } } },
    { ...starter, roles: { assistant: { ...role, model: ' ' } } },
    { ...starter, instruction: ' ' },
    { ...starter, maxIterations: 0 },
    { ...starter, kind: 'unknown' },
  ])('refuses unknown/invalid starter values %j', (input) =>
    expect(TemplateSettingsSchema.safeParse(input).success).toBe(false),
  );
  it.each(['relative/repo', 'C:/repos/../outside', 'C:/repos/\nother'])(
    'refuses unsafe repository path %s',
    (path) =>
      expect(TemplateRepositorySchema.safeParse({ ...repository, path }).success).toBe(false),
  );
  it.each([
    '-main',
    'a..b',
    'a.lock',
    'a b',
    'a//b',
    'a/.hidden',
    'a@{b',
    '/main',
    'main.',
    'main/',
    'a.lock/b',
  ])('refuses invalid branch %s', (baseBranch) =>
    expect(TemplateRepositorySchema.safeParse({ ...repository, baseBranch }).success).toBe(false),
  );
  it.each(['.', '..'])('refuses special repository names %s', (name) =>
    expect(TemplateRepositorySchema.safeParse({ ...repository, name }).success).toBe(false),
  );
  it('accepts POSIX/UNC paths and nested refs without interpreting values', () => {
    expect(
      TemplateRepositorySchema.safeParse({
        ...repository,
        path: '/home/repo',
        baseBranch: 'feature/one',
      }).success,
    ).toBe(true);
    expect(
      TemplateRepositorySchema.safeParse({ ...repository, path: '\\\\host\\share\\repo' }).success,
    ).toBe(true);
    expect(
      TemplateGateSchema.parse({ args: ['literal&value', '$(never-evaluated)'] }).args,
    ).toEqual(['literal&value', '$(never-evaluated)']);
  });
  it.each(['pnpm.cmd', 'COMMAND.BAT'])('refuses batch program %s', (program) =>
    expect(TemplateGateSchema.safeParse({ program }).success).toBe(false),
  );
  it('refuses NUL args, malformed labels and expanded automatic limits', () => {
    expect(TemplateGateSchema.safeParse({ args: ['a\0b'] }).success).toBe(false);
    expect(
      ImplementationTemplateSettingsSchema.safeParse({
        kind: 'implementation',
        ...common,
        roles: { implementer: role },
        labels: { trigger: 'one,two' },
      }).success,
    ).toBe(false);
    expect(
      ReviewTemplateSettingsSchema.safeParse({
        kind: 'review',
        ...common,
        roles: { reviewer: role, fixer: role },
        limits: { automaticCycles: 4 },
      }).success,
    ).toBe(false);
    expect(
      QaTemplateSettingsSchema.safeParse({
        kind: 'qa',
        ...common,
        roles: { qa: role, adversary: role },
        limits: { reopenings: 3 },
      }).success,
    ).toBe(false);
  });
});

describe('template manifest and public DTOs', () => {
  it('round-trips catalog/instance endpoints with one draft parent', () => {
    const entry = {
      manifest,
      settingsSchema: z.toJSONSchema(StarterTemplateSettingsSchema),
      defaultSettings: starter,
      prerequisites: report,
    };
    expect(TemplateListResponseSchema.parse({ items: [entry] }).items[0]?.manifest.parentKey).toBe(
      'main',
    );
    expect(TemplateCatalogEntrySchema.safeParse({ ...entry, defaultSettings: null }).success).toBe(
      true,
    );
    expect(
      TemplateCatalogEntrySchema.safeParse({ ...entry, manifest: { ...manifest, kind: 'qa' } })
        .success,
    ).toBe(false);
    expect(TemplatePrerequisiteRequestSchema.parse({ settings: starter }).settings.kind).toBe(
      'starter',
    );
    expect(
      TemplateInstantiateRequestSchema.parse({ settings: starter, name: 'My assistant' }).name,
    ).toBe('My assistant');
    expect(
      TemplateInstantiateResponseSchema.parse({ instance, prerequisites: report }).instance.loops,
    ).toHaveLength(2);
  });
  it.each([
    '../outside.json',
    '/root.json',
    'C:/root.json',
    'a\\b.json',
    'a//b.json',
    'a/./b.json',
    'a.txt',
  ])('refuses manifest export path %s', (file) =>
    expect(
      TemplateManifestSchema.safeParse({ ...manifest, loops: [{ key: 'main', file }] }).success,
    ).toBe(false),
  );
  it('refuses unknown manifest/endpoint fields', () => {
    expect(TemplateManifestSchema.safeParse({ ...manifest, execute: 'unsafe' }).success).toBe(
      false,
    );
    expect(
      TemplateInstantiateRequestSchema.safeParse({ settings: starter, publish: true }).success,
    ).toBe(false);
  });
  it('reports runtime isolation unavailable while authoring is possible', () => {
    const check = {
      id: 'adversary-isolation',
      label: 'Isolation',
      status: 'unavailable',
      blocking: 'runtime',
      message: 'No enforcing runner',
      remediation: 'Use an enforcing runner after it is supported.',
    };
    expect(
      TemplatePrerequisiteReportSchema.parse({
        checks: [check],
        canInstantiate: true,
        canRun: false,
      }).canInstantiate,
    ).toBe(true);
    expect(
      TemplatePrerequisiteReportSchema.safeParse({
        checks: [{ ...check, blocking: 'authoring' }],
        canInstantiate: true,
        canRun: false,
      }).success,
    ).toBe(false);
    expect(
      TemplatePrerequisiteReportSchema.safeParse({
        checks: [check],
        canInstantiate: true,
        canRun: true,
      }).success,
    ).toBe(false);
    expect(
      TemplatePrerequisiteReportSchema.safeParse({
        checks: [{ ...check, remediation: undefined }],
        canInstantiate: true,
        canRun: false,
      }).success,
    ).toBe(false);
    expect(
      TemplatePrerequisiteReportSchema.safeParse({
        checks: [check, check],
        canInstantiate: true,
        canRun: false,
      }).success,
    ).toBe(false);
    expect(
      TemplatePrerequisiteReportSchema.safeParse({
        checks: [{ ...check, status: 'ok' }],
        canInstantiate: true,
        canRun: true,
      }).success,
    ).toBe(true);
  });
  it.each([
    { ...instance, parentLoopId: fakeUlid('missing') },
    { ...instance, loops: [{ ...parent, status: 'published' }, child] },
    { ...instance, loops: [parent, { ...child, status: 'draft' }] },
    { ...instance, loops: [parent, { ...child, key: 'main' }] },
    { ...instance, loops: [parent, { ...child, versionId: parent.versionId }] },
    { ...instance, loops: [parent, parent] },
  ])('refuses orphan/armed/duplicate instance data %j', (input) =>
    expect(TemplateInstanceSchema.safeParse(input).success).toBe(false),
  );
});
