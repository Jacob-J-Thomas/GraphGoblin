#!/usr/bin/env node
/** Validate shipped data without a running app or any harness invocation. */
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { TemplateBundleError, validateTemplateDraft } from '@graphgoblin/domain';
import { TemplateCatalog } from '../src/templates/catalog.js';

const catalog = new TemplateCatalog(fileURLToPath(new URL('../templates', import.meta.url)));
const entries = await catalog.list();
assert.ok(entries.length > 0, 'The shipped catalog must contain at least one template');
for (const { draft } of entries) {
  assert.ok(draft, 'Every shipped template must provide an editable starting point');
  validateTemplateDraft(draft);
  const invalidDraft = globalThis.structuredClone(draft);
  invalidDraft.edges[0].to.node = 'deliberately-missing-draft-target';
  assert.throws(() => validateTemplateDraft(invalidDraft), TemplateBundleError);
}
process.stdout.write(
  `Templates: ${entries.length} shipped starting points valid; deliberately invalid graphs refused.\n`,
);
