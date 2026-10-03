#!/usr/bin/env node
/**
 * Repository gate: every production dependency in the workspace must carry an
 * allowlisted licence. See tooling/license-allowlist.json and docs/11-security-and-distribution.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLicenses, flattenPnpmLicenses } from './licenses.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const policy = JSON.parse(readFileSync(join(root, 'tooling', 'license-allowlist.json'), 'utf8'));

let raw;
try {
  raw = execFileSync('pnpm', ['-r', 'licenses', 'list', '--json', '--prod', '--long'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error(
    'Failed to run `pnpm licenses list`:',
    error instanceof Error ? error.message : error,
  );
  process.exit(2);
}

const packages = flattenPnpmLicenses(JSON.parse(raw));
if (packages.length === 0) {
  console.error('Licence check inspected zero packages; that is almost certainly a tooling error.');
  process.exit(2);
}
const violations = evaluateLicenses(policy, packages);
if (violations.length > 0) {
  console.error(`Licence violations (${violations.length}):`);
  for (const v of violations) console.error(`  ${v.name}: ${v.reason}`);
  console.error('Add an exception to tooling/license-allowlist.json only with a justification.');
  process.exit(1);
}
console.error(`Licence allowlist: OK (${packages.length} packages checked)`);
