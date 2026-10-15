import { describe, expect, it } from 'vitest';
import {
  TemplateCatalogEntrySchema,
  TemplateListResponseSchema,
  TemplateManifestSchema,
  TemplateDraftRequestSchema,
} from './template-manifest.js';

const starter = {
  kind: 'starter',
  roles: { assistant: { harness: 'codex', model: 'catalog-model', effort: 'high' } },
};
const manifest = {
  id: 'starter',
  version: '1.0.0',
  title: 'Starter',
  description: 'A manual assistant.',
  draftFile: 'draft.json',
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

describe('catalogue DTOs', () => {
  it('round-trips manifests and rejects configured catalogue metadata', () => {
    const entry = { manifest: TemplateManifestSchema.parse(manifest) };
    expect(TemplateCatalogEntrySchema.parse(entry)).toEqual(entry);
    expect(TemplateListResponseSchema.parse({ items: [entry] })).toEqual({ items: [entry] });
    for (const removed of [
      'settingsSchema',
      'defaultSettings',
      'prerequisites',
      'instance',
      'loops',
    ])
      expect(TemplateCatalogEntrySchema.safeParse({ ...entry, [removed]: null }).success).toBe(
        false,
      );
  });
});
