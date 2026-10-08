import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installedFile } from '../assets.js';
import { SUPPORT_VERSION } from './protocol.js';
import { TemplateError } from '../errors.js';

const modules = [
  'authority',
  'binding',
  'errors',
  'subjects',
  'github/client',
  'github/entry',
  'github/implementation',
  'github/process',
  'github/protocol',
  'github/repository',
  'github/storage',
  'github/support-input',
].sort();
export const IMPLEMENTATION_SUPPORT_ENTRY = 'dist/templates/github/entry.js';
/** Explicit development/build selection. Every executable delegate is included in a sorted closure. */
export async function implementationSupportClosure(
  packageRoot: string,
  version: string,
  source: boolean,
) {
  if (version !== SUPPORT_VERSION)
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'The implementation support version differs from its manifest.',
    );
  const prefix = source ? 'src/templates/' : 'dist/templates/';
  const extension = source ? '.ts' : '.js';
  const hash = createHash('sha256');
  let size = 0,
    entry = '';
  for (const module of modules) {
    const path = await installedFile(packageRoot, prefix + module + extension);
    const bytes = await readFile(path);
    size += bytes.length;
    if (size > 2097152)
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'The implementation support closure exceeds its bound.',
      );
    hash.update(module + '.js\0');
    hash.update(bytes);
    hash.update('\0');
    if (module === 'github/entry') entry = path;
  }
  return { path: entry, hash: hash.digest('hex') };
}
