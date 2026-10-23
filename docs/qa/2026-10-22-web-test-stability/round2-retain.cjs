const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const out = path.join(root, 'docs/qa/2026-10-22-web-test-stability');
const temp = process.env.TEMP;
const audit = path.join(temp, 'gg-audit-chore-384-20261022');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function redact(bytes) {
  for (const prefix of [process.env.USERPROFILE, process.env.USERPROFILE.replaceAll('\\', '/'), process.env.USERPROFILE.replaceAll('\\', '\\\\'), process.env.USERNAME]) {
    for (const encoding of ['utf8', 'utf16le']) {
      const needle = Buffer.from(prefix, encoding);
      const replacement = Buffer.from('<USERPROFILE>', encoding);
      let at;
      while ((at = bytes.indexOf(needle)) !== -1) bytes = Buffer.concat([bytes.subarray(0, at), replacement, bytes.subarray(at + needle.length)]);
    }
  }
  return bytes;
}
const provenance = [];
function retain(source, name, note) {
  const original = fs.readFileSync(source);
  const retained = redact(original);
  fs.writeFileSync(path.join(out, name), retained);
  provenance.push({name, source: path.basename(source), originalSha256: sha(original), retainedSha256: sha(retained), note: note || 'Original bytes with local user-directory prefix redacted in UTF-8 and UTF-16LE.'});
}
const refs = JSON.parse(fs.readFileSync(path.join(audit, 'static-audit.json'), 'utf8')).references;
for (const {ref} of refs) {
  if (ref.endsWith('.log')) retain(path.join(temp, ref), ref + '.txt');
  else if (ref.endsWith('.cjs')) retain(path.join(temp, ref), ref);
}
retain(path.join(temp, 'gg-chore-web-browser.cjs'), 'gg-chore-web-browser.cjs');
const config = `import config from './playwright.config.js';
export default {
  ...config,
  globalSetup: './e2e/gg-chore-web-global-setup.ts',
  retries: 0,
  outputDir: ${JSON.stringify(path.join(temp, 'gg-chore-web-browser-results'))},
};
`;
const configName = 'gg-chore-web-playwright.config.ts';
fs.writeFileSync(path.join(out, configName), redact(Buffer.from(config)));
provenance.push({name: configName, retainedSha256: sha(redact(Buffer.from(config))), note: 'Reconstructed exactly from the retained browser generator; the disposable original config was removed after round 1.'});
for (const name of ['run-matrix.cjs', 'status-probe.cjs', 'status-mutation.patch.txt', 'static-audit.json', 'verified-parallel-1.log.txt', 'verified-matrix-results.json']) {
  if (fs.existsSync(path.join(audit, name))) retain(path.join(audit, name), 'audit-' + name);
}
fs.writeFileSync(path.join(out, 'evidence-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
for (const name of process.argv.includes('--raw-only') ? [] : ['before.md', 'after.md']) {
  let text = fs.readFileSync(path.join(out, name), 'utf8');
  text = text.replace('`%TEMP%\\gg-chore-web-run-{1,2,3}.log`', '[gg-chore-web-run-1.log.txt](gg-chore-web-run-1.log.txt), [gg-chore-web-run-2.log.txt](gg-chore-web-run-2.log.txt), [gg-chore-web-run-3.log.txt](gg-chore-web-run-3.log.txt)');
  text = text.replace('`%TEMP%\\gg-chore-web-repeat-{preset,keyboard,default,existing,kinds,advanced}.log`', ['preset','keyboard','default','existing','kinds','advanced'].map(group => `[gg-chore-web-repeat-${group}.log.txt](gg-chore-web-repeat-${group}.log.txt)`).join(', '));
  for (const {ref} of refs) {
    const retainedName = ref.endsWith('.log') ? ref + '.txt' : ref;
    text = text.replaceAll('`%TEMP%\\' + ref + '`', `[${retainedName}](${retainedName})`);
  }
  text = text.replaceAll('Raw local log:', 'Retained log:').replaceAll('local log\n', 'retained log\n');
  text = text.replace('The load generator and runner logs use the prefix `gg-chore-web-` in system temp.', 'The retained load generator and transcripts are beside this document; local user-directory prefixes are redacted.');
  text = text.replace('Those three temporary files were removed;', 'The disposable config is reconstructed from [gg-chore-web-browser.cjs](gg-chore-web-browser.cjs) as [gg-chore-web-playwright.config.ts](gg-chore-web-playwright.config.ts). Those three temporary files were removed;');
  fs.writeFileSync(path.join(out, name), text);
}
console.log('Retained', provenance.length, 'artifacts; original and redacted hashes recorded.');
