#!/usr/bin/env node
/** Validate shipped data without a running app or any harness invocation. */
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { readdir } from 'node:fs/promises';
import { TemplateBundleError, validateTemplateDraft } from '@graphgoblin/domain';
import { TemplateCatalog } from '../src/templates/catalog.js';

const catalog = new TemplateCatalog(fileURLToPath(new URL('../templates', import.meta.url)));
const entries = await catalog.list();
assert.deepEqual(entries.map(({ manifest }) => manifest.id).sort(), [
  'implementation',
  'qa',
  'review',
  'starter',
]);
async function assetFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? (await assetFiles(new URL(`${entry.name}/`, root))).map(
              (file) => `${entry.name}/${file}`,
            )
          : [entry.name],
      ),
    )
  )
    .flat()
    .sort();
}
assert.deepEqual(
  await assetFiles(new URL('../templates/', import.meta.url)),
  [
    'catalog.json',
    ...entries.flatMap(({ manifest }) => [
      `${manifest.id}/manifest.json`,
      `${manifest.id}/draft.json`,
    ]),
  ].sort(),
  'Only the catalogue index, manifests and independent drafts may ship',
);
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
