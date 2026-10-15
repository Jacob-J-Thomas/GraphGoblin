import { copyFile, lstat, mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { TemplateManifestSchema, TemplateRelativePathSchema } from '@graphgoblin/contracts';
import { installedFile, TemplateCatalog } from './catalog.js';

/** Only the index, manifests and validated starting graphs belong in the installed catalogue. */
export async function copyCatalog(source: string, target: string): Promise<void> {
  await new TemplateCatalog(source).list();
  const manifests = z
    .array(TemplateRelativePathSchema)
    .parse(
      JSON.parse(await readFile(await installedFile(source, 'catalog.json'), 'utf8')) as unknown,
    );
  const files = ['catalog.json'];
  for (const file of manifests) {
    const manifest = TemplateManifestSchema.parse(
      JSON.parse(await readFile(await installedFile(source, file), 'utf8')) as unknown,
    );
    files.push(file, join(dirname(file), manifest.draftFile));
  }
  // A rebuild must not leave graphs or support assets from an older catalogue behind.
  // Unlink individual files; leave empty directories for the workspace owner.
  async function clearFiles(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Catalogue target links are not permitted.');
      if (entry.isDirectory()) await clearFiles(path);
      else await unlink(path);
    }
  }
  const targetRoot = resolve(target);
  await mkdir(targetRoot, { recursive: true });
  if ((await lstat(targetRoot)).isSymbolicLink() || (await realpath(targetRoot)) !== targetRoot)
    throw new Error('The catalogue target must be a canonical directory.');
  await clearFiles(targetRoot);
  for (const file of files) {
    const destination = join(targetRoot, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(await installedFile(source, file), destination);
  }
}
