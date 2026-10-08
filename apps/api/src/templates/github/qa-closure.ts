import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installedFile } from '../assets.js';
import { TemplateError } from '../errors.js';
import { QA_SUPPORT_VERSION } from './qa-entry.js';
export const QA_SUPPORT_ENTRY = 'dist/templates/github/qa-entry.js';
/** Every local executable delegate of qa-entry, including schemas, is bound to the instance. */
export const QA_SUPPORT_MODULES = [
  'authority',
  'binding',
  'errors',
  'subjects',
  'support-result',
  'github/client',
  'github/process',
  'github/protocol',
  'github/repository',
  'github/storage',
  'github/support-input',
  'github/support-output',
  'github/review-client',
  'github/qa-client',
  'github/qa-entry',
  'github/qa-native',
  'github/qa-envelope',
  'github/qa-protocol',
].sort();
export async function qaSupportClosure(packageRoot: string, version: string, source: boolean) {
  if (version !== QA_SUPPORT_VERSION)
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'The QA support version differs from its manifest.',
    );
  const prefix = source ? 'src/templates/' : 'dist/templates/',
    extension = source ? '.ts' : '.js',
    hash = createHash('sha256');
  let size = 0,
    entry = '';
  for (const module of QA_SUPPORT_MODULES) {
    const path = await installedFile(packageRoot, prefix + module + extension),
      bytes = await readFile(path);
    size += bytes.length;
    if (size > 2097152)
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'The QA support closure exceeds its bound.',
      );
    hash.update(module + '.js\0');
    hash.update(bytes);
    hash.update('\0');
    if (module === 'github/qa-entry') entry = path;
  }
  return { path: entry, hash: hash.digest('hex') };
}
