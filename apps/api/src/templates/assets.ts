import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TemplateError } from './errors.js';

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
