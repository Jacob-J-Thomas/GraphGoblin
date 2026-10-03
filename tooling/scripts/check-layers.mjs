#!/usr/bin/env node
/**
 * Repository gate: every workspace package may only depend on the @graphgoblin/*
 * packages its layer allows. See tooling/layers.json and docs/02-architecture.md.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLayers, collectDependencies } from './layers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const policy = JSON.parse(readFileSync(join(root, 'tooling', 'layers.json'), 'utf8'));

/** @returns {import('./layers.mjs').WorkspacePackage[]} */
function loadWorkspacePackages() {
  const packages = [];
  for (const dir of ['packages', 'apps']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(base, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      packages.push({
        name: manifest.name ?? `<unnamed ${dir}/${entry.name}>`,
        dependencies: collectDependencies(manifest),
        location: `${dir}/${entry.name}`,
      });
    }
  }
  return packages;
}

const violations = evaluateLayers(policy, loadWorkspacePackages());
if (violations.length > 0) {
  console.error(`Layer rule violations (${violations.length}):`);
  for (const v of violations) {
    console.error(`  ${v.location} (${v.package}): ${v.message}`);
  }
  process.exit(1);
}
console.error('Layer rules: OK');
