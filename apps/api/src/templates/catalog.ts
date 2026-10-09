import { installedFile } from './assets.js';
export { installedFile } from './assets.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  LoopExportSchema,
  TemplateManifestSchema,
  TemplateRelativePathSchema,
  type TemplateBundle,
} from '@graphgoblin/contracts';
import { validateTemplateBundle } from '@graphgoblin/domain';
import { TemplateError } from './errors.js';
import {
  IMPLEMENTATION_SUPPORT_ENTRY,
  implementationSupportClosure,
} from './github/support-closure.js';

export interface CatalogBundle {
  bundle: TemplateBundle;
  support?: { path: string; hash: string };
}
const IndexSchema = z.array(TemplateRelativePathSchema).max(100);
async function json(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(await installedFile(root, path), 'utf8')) as unknown;
}
export class TemplateCatalog {
  constructor(
    readonly root: string,
    readonly packageRoot: string,
    readonly sourceSupport = import.meta.url.endsWith('.ts'),
  ) {}
  async list(): Promise<CatalogBundle[]> {
    try {
      const files = IndexSchema.parse(await json(this.root, 'catalog.json'));
      const entries: CatalogBundle[] = [];
      for (const file of files) {
        const manifest = TemplateManifestSchema.parse(await json(this.root, file));
        const folder = dirname(file);
        const definitions: TemplateBundle['loops'] = {};
        for (const loop of manifest.loops) {
          const exported = LoopExportSchema.parse(await json(this.root, join(folder, loop.file)));
          definitions[loop.key] = exported.loop;
        }
        const { bundle } = validateTemplateBundle({ manifest, loops: definitions });
        let support: CatalogBundle['support'];
        if (manifest.supportEntry) {
          if (!/^(dist|templates)\//.test(manifest.supportEntry))
            throw new TemplateError(
              'TEMPLATE_PACKAGE_INVALID',
              'Support entries must belong to the shipped dist/ or templates/ package files.',
            );
          if (manifest.supportEntry === IMPLEMENTATION_SUPPORT_ENTRY)
            support = await implementationSupportClosure(
              this.packageRoot,
              manifest.version,
              this.sourceSupport,
            );
          else {
            const path = await installedFile(this.packageRoot, manifest.supportEntry);
            support = {
              path,
              hash: createHash('sha256')
                .update(await readFile(path))
                .digest('hex'),
            };
          }
        }
        entries.push({ bundle, ...(support ? { support } : {}) });
      }
      if (new Set(entries.map((entry) => entry.bundle.manifest.id)).size !== entries.length)
        throw new Error('duplicate catalog IDs');
      return entries;
    } catch (error) {
      if (error instanceof TemplateError) throw error;
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'The installed template catalog is invalid; reinstall the package.',
        503,
      );
    }
  }
  async get(id: string): Promise<CatalogBundle> {
    const entry = (await this.list()).find((item) => item.bundle.manifest.id === id);
    if (!entry)
      throw new TemplateError('TEMPLATE_NOT_FOUND', 'This template is not registered.', 404);
    return entry;
  }
}
