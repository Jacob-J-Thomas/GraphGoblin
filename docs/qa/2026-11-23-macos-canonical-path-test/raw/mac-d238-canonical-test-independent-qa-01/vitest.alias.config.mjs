import base from 'file:///G:/ggq/gg-mac-d238-alias-qa/GraphGoblin/apps/api/vitest.config.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const evidence = fileURLToPath(new URL('.', import.meta.url));
const apiRoot = 'G:/ggq/gg-mac-d238-alias-qa/GraphGoblin/apps/api';
const parent = process.argv.includes('src/main.d238-parent.independent.qa.test.ts');
const corrected = process.argv.includes('src/main.test.ts');
if (parent === corrected) throw new Error('Expected exactly one admitted test file selection.');
const alias = JSON.parse(fs.readFileSync(path.join(evidence, 'ALIAS.json'), 'utf8'));
const entry = path.join(apiRoot, 'dist/main.js');
export default {
  ...base,
  root: apiRoot,
  test: {
    ...base.test,
    setupFiles: [...base.test.setupFiles, path.join(evidence, 'worker-alias.setup.mjs')],
    provide: { ...base.test.provide, d238Alias: {
      ...alias, evidence, entry, stage: parent ? 'parent-negative' : 'corrected-positive',
      entrySha256: createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),
      coordinator: { TEMP: process.env.TEMP ?? null, TMP: process.env.TMP ?? null, tmpdir: os.tmpdir() },
      environmentAmendment: 'D239: owned API child GG_OLLAMA_ENABLED=false only',
    } },
  },
};
