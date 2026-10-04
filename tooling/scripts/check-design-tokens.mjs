#!/usr/bin/env node
/** Repository gate: component colours belong in apps/web/src/styles/. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDesignTokens, shouldScanTokens } from './design-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root =
  args.length === 2 && args[0] === '--root' ? resolve(args[1]) : resolve(here, '..', '..');

// The only optional exceptions: one named, exact declaration in each config file.
// Keep this empty until integration needs it. Example shape:
// { file: 'apps/web/vite.config.ts', name: 'SHELL_COLOUR', declaration: "const SHELL_COLOUR = '#0e0c0a';" }
// For index.html the exact declaration is the palette-backed theme-color meta tag.
// Never add a file-wide, value-wide, or inline-comment suppression.
/** @type {import('./design-tokens.mjs').TokenException[]} */
const CONFIG_EXCEPTIONS = [];

/** @param {string} directory @returns {string[]} */
function files(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (path === 'apps/web/src/styles' || entry.name === '__fixtures__') return [];
      return files(path);
    }
    return entry.isFile() && shouldScanTokens(path) ? [path] : [];
  });
}

try {
  if (args.length && !(args.length === 2 && args[0] === '--root')) {
    throw new Error('Usage: node tooling/scripts/check-design-tokens.mjs [--root <repository>]');
  }
  const paths = [...files('apps/web/src'), 'apps/web/index.html', 'apps/web/vite.config.ts'].sort();
  const violations = paths.flatMap((file) =>
    scanDesignTokens(readFileSync(join(root, file), 'utf8'), file, CONFIG_EXCEPTIONS),
  );
  if (violations.length > 0) {
    console.error(`Design token violations (${violations.length}):`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}: ${violation.text}`);
    }
    process.exitCode = 1;
  } else {
    console.error(`Design tokens: OK (${paths.length} files checked)`);
  }
} catch (error) {
  console.error('Design token check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
