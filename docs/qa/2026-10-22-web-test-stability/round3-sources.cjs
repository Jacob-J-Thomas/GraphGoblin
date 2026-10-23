const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const git = args => cp.execFileSync('git', args, {encoding: 'utf8', windowsHide: true}).trim();
const files = [
  'apps/web/src/editor/EditorPage.restore.test.tsx',
  'apps/web/src/editor/EditorPage.test.tsx',
  'apps/web/src/styles/code-theme.test.ts',
  'apps/web/src/editor/useLoadEditor.test.tsx',
  'apps/web/src/editor/EditorPage.tsx',
  'apps/web/src/editor/useLoadEditor.ts',
  'apps/web/src/editor/useAutosave.ts',
  'apps/web/src/styles/code-theme.ts',
  'apps/web/src/drafts/local-drafts.ts',
  'apps/web/vitest.config.ts',
  'tooling/vitest.shared.mjs',
];
const rows = files.map(file => ({file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), gitBlob: git(['hash-object', '--path=' + file, file])}));
const destination = path.join(process.env.TEMP, 'gg-chore-web-round3-source-binding.json');
if (process.argv.includes('--check')) {
  const previous = JSON.parse(fs.readFileSync(destination, 'utf8'));
  if (JSON.stringify(previous.rows) !== JSON.stringify(rows)) throw new Error('Tested-source bytes changed');
} else fs.writeFileSync(destination, JSON.stringify({head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), rows}, null, 2) + '\n');
const changed = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
const unexpected = changed.filter(file => !file.startsWith('docs/qa/2026-10-22-web-test-stability/') && !files.slice(0, 4).includes(file));
if (unexpected.length) throw new Error('Unexpected changed paths: ' + unexpected.join(', '));
console.log(JSON.stringify({mode: process.argv.includes('--check') ? 'check' : 'snapshot', sources: rows.length, unexpectedChangedPaths: unexpected.length, productionAndVitestUnchanged: files.slice(4).every(file => !changed.includes(file))}));
