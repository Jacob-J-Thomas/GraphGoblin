const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
const prettier = rootRequire('prettier');
const sha = s => createHash('sha256').update(s).digest('hex');
(async () => {
  const source = '{"recorded":true,"hashBound":1}\n';
  const filepath = 'docs/qa/gg-chore-web-byte-probe.json';
  const info = await prettier.getFileInfo(filepath, {ignorePath: '.prettierignore'});
  const formatted = info.ignored ? source : await prettier.format(source, {filepath});
  console.log(JSON.stringify({filepath, ignored:info.ignored, sourceSha256:sha(source), formatterSha256:sha(formatted), unchanged:source === formatted}));
  for (const ext of ['json','yaml','yml','js','mjs','cjs','ts','mts','cts','md']) {
    const result = await prettier.getFileInfo('docs/qa/gg-chore-web-example.' + ext, {ignorePath: '.prettierignore'});
    console.log(JSON.stringify({extension:ext,ignored:result.ignored}));
    if (result.ignored !== (ext !== 'md')) process.exitCode = 1;
  }
})();
