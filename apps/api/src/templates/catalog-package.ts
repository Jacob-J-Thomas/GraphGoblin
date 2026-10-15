import { copyFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
      if (entry.isDirectory()) await clearFiles(path);
      else await unlink(path);
    }
  }
  await mkdir(target, { recursive: true });
  await clearFiles(target);
  for (const file of files) {
    const destination = join(target, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(await installedFile(source, file), destination);
  }
}
