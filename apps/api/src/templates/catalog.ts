import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  LoopExportSchema,
  TemplateManifestSchema,
  TemplateRelativePathSchema,
  type LoopDefinition,
  type TemplateManifest,
} from '@graphgoblin/contracts';
import { validateTemplateDraft } from '@graphgoblin/domain';
import { installedFile } from './assets.js';
import { TemplateError } from './errors.js';
export { installedFile } from './assets.js';

export interface CatalogDraft {
  manifest: TemplateManifest;
  draft: LoopDefinition;
}
const IndexSchema = z.array(TemplateRelativePathSchema).max(100);
async function json(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(await installedFile(root, path), 'utf8')) as unknown;
}

/** Installed starting graphs only. Loading never consults runtime services or support code. */
export class TemplateCatalog {
  constructor(readonly root: string) {}

  async list(): Promise<CatalogDraft[]> {
    try {
      const files = IndexSchema.parse(await json(this.root, 'catalog.json'));
      const entries: CatalogDraft[] = [];
      for (const file of files) {
        const manifest = TemplateManifestSchema.parse(await json(this.root, file));
        if (!manifest.draftFile) throw new Error('missing draft asset');
        const exported = LoopExportSchema.parse(
          await json(this.root, join(dirname(file), manifest.draftFile)),
        );
        entries.push({ manifest, draft: validateTemplateDraft(exported.loop) });
      }
      if (new Set(entries.map((entry) => entry.manifest.id)).size !== entries.length)
        throw new Error('duplicate catalog IDs');
      return entries;
    } catch {
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'The installed template catalog is invalid; reinstall the package.',
        503,
      );
    }
  }

  async get(id: string): Promise<CatalogDraft> {
    const entry = (await this.list()).find((item) => item.manifest.id === id);
    if (!entry)
      throw new TemplateError('TEMPLATE_NOT_FOUND', 'This template is not registered.', 404);
    return entry;
  }

  async draft(id: string): Promise<LoopDefinition> {
    return structuredClone((await this.get(id)).draft);
  }
}
