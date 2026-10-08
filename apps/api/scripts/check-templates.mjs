#!/usr/bin/env node
/** Validate shipped data without a running app or any harness invocation. */
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { TemplateBundleError, validateTemplateBundle } from '@graphgoblin/domain';
import { TemplateCatalog } from '../src/templates/catalog.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const catalog = new TemplateCatalog(
  fileURLToPath(new URL('../templates', import.meta.url)),
  packageRoot,
);
const entries = await catalog.list();
assert.ok(entries.length > 0, 'The shipped catalog must contain at least one template');
for (const { bundle } of entries) {
  validateTemplateBundle(bundle);
  // A schema-valid graph with a missing target must fail the same validation used by admission.
  const invalid = globalThis.structuredClone(bundle);
  const parent = invalid.loops[invalid.manifest.parentKey];
  assert.ok(parent?.edges.length, 'The shipped parent must have a connected workflow');
  parent.edges[0].to.node = 'deliberately-missing-gate-target';
  assert.throws(
    () => validateTemplateBundle(invalid),
    TemplateBundleError,
    'The template gate accepted a deliberately invalid graph',
  );
}
process.stdout.write(
  `Templates: ${entries.length} shipped bundles valid; ${entries.length} deliberately invalid graphs refused.\n`,
);
