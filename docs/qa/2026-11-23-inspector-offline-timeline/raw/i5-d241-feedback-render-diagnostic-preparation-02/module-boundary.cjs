const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin';
if (process.version !== 'v22.23.4') throw new Error('Admitted project Node22.23.4 required');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const req = createRequire(path.join(root, 'apps/web/package.json'));
const names = ['react', 'react-dom', '@tanstack/react-query', '@testing-library/react',
  'vitest', 'jsdom', 'typescript', 'zod', '@playwright/test', 'prettier'];
const selected = names.map((name) => {
  const entry = req.resolve(name);
  let directory = path.dirname(fs.realpathSync(entry));
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Package manifest not found: ${name}`);
    directory = parent;
  }
  const manifest = path.join(directory, 'package.json');
  return { name, entry, realEntry: fs.realpathSync(entry), entrySha256: sha(entry),
    manifest, manifestSha256: sha(manifest), version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version };
});
const core = createRequire(req.resolve('@tanstack/react-query')).resolve('@tanstack/query-core');
selected.push({ name: '@tanstack/query-core', entry: core, realEntry: fs.realpathSync(core), entrySha256: sha(core) });
process.stdout.write(JSON.stringify({
  utc: new Date().toISOString(), node: { version: process.version, path: process.execPath, sha256: sha(process.execPath) },
  selected, limit: 'Fresh createRequire resolution and selected entry/manifest identity; no application/test module import and no exhaustive installation claim.'
}, null, 2) + '\n');
