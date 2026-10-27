// Independent F1 record preparation; never changes product sources or earlier records.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const qa = path.dirname(here);
const copies = [];
function copy(folder, source, target = source, transform = s => s) {
  const sourcePath = path.join(qa, folder, source);
  const raw = fs.readFileSync(sourcePath);
  fs.writeFileSync(path.join(here, target), transform(raw.toString('utf8')).replace(/^\uFEFF/, ''), 'utf8');
  copies.push({ source: path.relative(path.resolve(here, '../../..'), sourcePath).replaceAll('\\', '/'), target, sourceSha256: crypto.createHash('sha256').update(raw).digest('hex') });
}
const ports = s => s.replaceAll('666', '663').replaceAll('gg-qa-422f-', 'gg-final-f1-').replaceAll("'6970'", "'6850'").replaceAll("'30'", "'40'");
for (const file of ['lib.mjs', 'behaviour.mjs', 'restarts.mjs', 'races.mjs', 'effect.mjs', 'fresh-followup.mjs', 'force-http.mjs'])
  copy('2026-10-27-pr422-qa-final', file, file, ports);
copy('2026-10-26-acceptance-a', 'session-cli.cs');
copy('2026-10-26-acceptance-fixes-319-205', 'scripts/console-tool.cs.txt', 'console-tool.cs');
copy('2026-10-26-pr418-qa-recheck', 'lib.mjs', 'observation-lib.mjs', s => s.replaceAll('gg-qa-418r-', 'gg-final-f1-observation-'));
copy('2026-10-27-pr412-qa-final', 'qa-server.mjs', 'capacity-server.mjs', s => {
  s = s.replaceAll('gg-qa-412f-', 'gg-final-f1-').replaceAll('6620', '6630').replaceAll('6629', '6639');
  s = s.replace(/^const testing = .*\r?\n/m, '');
  const start = s.indexOf('class QaHarness');
  const end = s.indexOf('const real =', start);
  s = s.slice(0, start) + s.slice(end);
  s = s.replace(/  harnesses: \{ codex: new QaHarness.*\r?\n/, '');
  s = s.replace('  GG_WEB_DIST: join(root,', "  GG_CODEX_BINARY: process.env.GG_CODEX_BINARY,\n  GG_CLAUDE_BINARY: process.env.GG_CLAUDE_BINARY,\n  GG_WEB_DIST: join(root,");
  return s;
});
fs.writeFileSync(path.join(here, 'copied-harnesses.json'), JSON.stringify(copies, null, 2) + '\n');
