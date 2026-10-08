import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  LoopExportSchema,
  TemplateManifestSchema,
  TemplateRelativePathSchema,
  type TemplateBundle,
} from '@graphgoblin/contracts';
import { validateTemplateBundle } from '@graphgoblin/domain';
import { TemplateError } from './errors.js';

export interface CatalogBundle {
  bundle: TemplateBundle;
  support?: { path: string; hash: string };
}
const IndexSchema = z.array(TemplateRelativePathSchema).max(100);
/** Reject symlinks/junctions at every component, rather than trusting lexical containment. */
export async function installedFile(rootInput: string, relativePath: string): Promise<string> {
  const root = resolve(rootInput);
  const path = resolve(root, relativePath);
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel.startsWith('..'))
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'The template package path is outside its installed root.',
    );
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'The installed template root must be a canonical directory.',
    );
  let current = root;
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'Template package links are not permitted.',
      );
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 1_048_576)
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'Template assets must be bounded regular files.',
    );
  return path;
}
async function json(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(await installedFile(root, path), 'utf8')) as unknown;
}
export class TemplateCatalog {
  constructor(
    readonly root: string,
    readonly packageRoot: string,
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
          const path = await installedFile(this.packageRoot, manifest.supportEntry);
          support = {
            path,
            hash: createHash('sha256')
              .update(await readFile(path))
              .digest('hex'),
          };
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
