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
  TemplateDraftRequestSchema,
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
  title: 'Starter',
  description: 'A manual assistant.',
  draftFile: 'draft.json',
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

describe('editable draft requests and manifest capability', () => {
  it('accepts an empty request and a literal optional name without execution settings', () => {
    expect(TemplateDraftRequestSchema.parse({})).toEqual({});
    expect(TemplateDraftRequestSchema.parse({ name: 'My draft' })).toEqual({ name: 'My draft' });
    expect(TemplateDraftRequestSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(TemplateDraftRequestSchema.safeParse({ settings: starter }).success).toBe(false);
  });
  it('requires a JSON draft asset using bounded package paths and defaults tags', () => {
    expect(TemplateManifestSchema.parse(manifest)).toEqual({ ...manifest, tags: [] });
    expect(TemplateManifestSchema.safeParse({ ...manifest, draftFile: undefined }).success).toBe(
      false,
    );
    for (const draftFile of [
      'draft.md',
      '../draft.json',
      '/draft.json',
      'a//draft.json',
      'a/./draft.json',
      'a/../draft.json',
      'a\\draft.json',
      'C:/draft.json',
      '',
      'a'.repeat(508) + '.json',
    ])
      expect(TemplateManifestSchema.safeParse({ ...manifest, draftFile }).success).toBe(false);
    expect(
      TemplateManifestSchema.parse({ ...manifest, draftFile: 'a'.repeat(507) + '.json' }).draftFile,
    ).toHaveLength(512);
    expect(
      TemplateManifestSchema.parse({ ...manifest, draftFile: 'graphs/starting-point.json' })
        .draftFile,
    ).toBe('graphs/starting-point.json');
  });
  it.each([
    'kind',
    'roles',
    'prerequisites',
    'requiredSecrets',
    'parentKey',
    'loops',
    'supportEntry',
  ])('strictly rejects the removed manifest field %s', (field) => {
    expect(TemplateManifestSchema.safeParse({ ...manifest, [field]: null }).success).toBe(false);
  });
  it('bounds IDs, semver, titles, descriptions and tags', () => {
    for (const value of [
      { id: '1bad' },
      { id: 'a'.repeat(65) },
      { version: '1.0' },
      { version: '01.0.0' },
      { version: '1.0.0-01' },
      { version: '1.0.0-' },
      { version: '1.0.0+..' },
      { version: '1.0.0-' + 'a'.repeat(59) },
      { title: '' },
      { title: 'a'.repeat(121) },
      { description: '' },
      { description: 'a'.repeat(4001) },
      { tags: [''] },
      { tags: ['a'.repeat(41)] },
      { tags: Array<string>(21).fill('tag') },
    ])
      expect(TemplateManifestSchema.safeParse({ ...manifest, ...value }).success).toBe(false);
    expect(
      TemplateManifestSchema.parse({ ...manifest, id: 'A_1-valid', version: '2.0.0-rc.1+build.5' })
        .version,
    ).toBe('2.0.0-rc.1+build.5');
    expect(
      TemplateManifestSchema.parse({
        ...manifest,
        version: '1.0.0-' + 'a'.repeat(58),
        title: 'a'.repeat(120),
        description: 'a'.repeat(4000),
        tags: Array<string>(20).fill('a'.repeat(40)),
      }).version,
    ).toHaveLength(64);
  });
});

describe('review trusted bot authors', () => {
  const input = { kind: 'review', ...common, roles: { reviewer: role, fixer: role } };
  it.each(['dependabot[bot]', 'github-actions[bot]', 'Writer', 'a'.repeat(39) + '[bot]'])(
    'accepts bounded explicit author %s without changing repository owner validation',
    (login) => {
      expect(
        ReviewTemplateSettingsSchema.parse({ ...input, trustedAuthors: [login] }).trustedAuthors,
      ).toEqual([login]);
      expect(
        TemplateRepositorySchema.safeParse({ ...repository, owner: 'dependabot[bot]' }).success,
      ).toBe(false);
    },
  );
  it.each([
    'a'.repeat(40) + '[bot]',
    'bot[bot][bot]',
    'bad/bot[bot]',
    'bot [bot]',
    'bot;gh',
    'bot%00',
    'bot[BOT]',
    '🤖[bot]',
  ])('refuses unsafe or unbounded author %s', (login) => {
    expect(
      ReviewTemplateSettingsSchema.safeParse({ ...input, trustedAuthors: [login] }).success,
    ).toBe(false);
  });
});
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
    const entry = { manifest: TemplateManifestSchema.parse(manifest) };
    expect(TemplateListResponseSchema.parse({ items: [entry] }).items[0]?.manifest.draftFile).toBe(
      'draft.json',
    );
    expect(TemplateCatalogEntrySchema.parse(entry)).toEqual(entry);
    for (const removed of ['settingsSchema', 'defaultSettings', 'prerequisites'])
      expect(TemplateCatalogEntrySchema.safeParse({ ...entry, [removed]: null }).success).toBe(
        false,
      );
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
    expect(TemplateManifestSchema.safeParse({ ...manifest, draftFile: file }).success).toBe(false),
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
