import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installedFile } from '../assets.js';
import { TemplateError } from '../errors.js';
import { REVIEW_SUPPORT_VERSION } from './review-protocol.js';
export const REVIEW_SUPPORT_ENTRY = 'dist/templates/github/review-entry.js';
export const REVIEW_SUPPORT_MODULES = [
  'authority',
  'binding',
  'errors',
  'subjects',
  'support-result',
  'github/support-output',
  'github/client',
  'github/process',
  'github/protocol',
  'github/repository',
  'github/storage',
  'github/support-input',
  'github/review-client',
  'github/review-entry',
  'github/review-protocol',
  'github/review-storage',
  'github/review',
].sort();
export async function reviewSupportClosure(packageRoot: string, version: string, source: boolean) {
  if (version !== REVIEW_SUPPORT_VERSION)
    throw new TemplateError(
      'TEMPLATE_PACKAGE_INVALID',
      'The review support version differs from its manifest.',
    );
  const prefix = source ? 'src/templates/' : 'dist/templates/',
    extension = source ? '.ts' : '.js',
    hash = createHash('sha256');
  let size = 0,
    entry = '';
  for (const module of REVIEW_SUPPORT_MODULES) {
    const path = await installedFile(packageRoot, prefix + module + extension),
      bytes = await readFile(path);
    size += bytes.length;
    if (size > 2097152)
      throw new TemplateError(
        'TEMPLATE_PACKAGE_INVALID',
        'The review support closure exceeds its bound.',
      );
    hash.update(module + '.js\0');
    hash.update(bytes);
    hash.update('\0');
    if (module === 'github/review-entry') entry = path;
  }
  return { path: entry, hash: hash.digest('hex') };
}
