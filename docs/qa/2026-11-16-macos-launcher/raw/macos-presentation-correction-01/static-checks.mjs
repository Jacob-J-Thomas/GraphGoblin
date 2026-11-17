// Static checks for the #456 presentation correction. Reads only; writes frozen originals
// to the directory given as argv[4] so that a diff can be produced against exact bytes.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';

const [capsulePath, pkgRoot, outDir] = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rel = (p) => relative(pkgRoot, p).split(/[\\/]/).join('/');
const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'));
const changed = ['Presentation/LaunchPresentationController.swift', 'Tests/Presentation/QuitTests.swift'];
const result = {
  capsule: { token: capsule.token, head: capsule.head, tree: capsule.tree, files: capsule.files.length },
  frozen: [], others: [], changed: [], hygiene: [], balance: [], tests: {},
};

// 1. Frozen bytes match their declared digest; non-owned and other owned files unchanged on disk.
for (const f of capsule.files) {
  const frozen = Buffer.from(f.data, 'base64');
  const declaredOk = frozen.length === f.bytes && sha(frozen) === f.sha256;
  let disk = null;
  try { disk = readFileSync(join(pkgRoot, f.path)); } catch { /* missing */ }
  const entry = {
    path: f.path, frozenBytes: f.bytes, frozenSha256: f.sha256, declaredOk,
    diskBytes: disk ? disk.length : null, diskSha256: disk ? sha(disk) : null,
  };
  entry.unchanged = disk !== null && entry.diskSha256 === f.sha256;
  if (changed.includes(f.path)) {
    result.frozen.push(entry);
    const out = join(outDir, 'frozen', f.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, frozen);
  } else {
    result.others.push(entry);
  }
}
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const capsulePaths = new Set(capsule.files.map((f) => f.path));
result.extraOnDisk = ['Presentation', 'Tests/Presentation']
  .flatMap((d) => walk(join(pkgRoot, d)).map(rel))
  .filter((p) => !capsulePaths.has(p));

// 2. Changed files: bytes, lines, digest, hygiene, delimiter balance.
for (const p of changed) {
  const buf = readFileSync(join(pkgRoot, p));
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  result.changed.push({ path: p, bytes: buf.length, lines: lines.length - 1, sha256: sha(buf) });
  const nonAscii = [...new Set([...text].filter((c) => c.codePointAt(0) > 0x7f))]
    .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  result.hygiene.push({
    path: p,
    validUtf8: Buffer.from(text, 'utf8').equals(buf),
    bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    cr: (text.match(/\r/g) || []).length,
    tabs: (text.match(/\t/g) || []).length,
    trailingWhitespaceLines: lines.map((l, i) => (/[ \t]+$/.test(l) ? i + 1 : 0)).filter(Boolean),
    finalNewline: text.endsWith('\n') && !text.endsWith('\n\n'),
    nonAscii,
  });
  // Swift-aware scan: skips // and nested /* */ comments and string literals (with \( ) interpolation).
  const stack = [];
  const problems = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const BS = String.fromCharCode(92);
  let i = 0;
  let line = 1;
  const pop = (c) => {
    const top = stack.pop();
    if (!top || top.c !== pairs[c]) problems.push(`unmatched ${c} at line ${line}`);
  };
  function scanString(multi) {
    const close = multi ? '"""' : '"';
    while (i < text.length) {
      if (text.startsWith(close, i)) { i += close.length; return; }
      const c = text[i];
      if (c === '\n') {
        if (!multi) { problems.push(`unterminated string at line ${line}`); return; }
        line++; i++; continue;
      }
      if (c === BS) {
        if (text[i + 1] === '(') {
          i += 2;
          let depth = 1;
          while (i < text.length && depth > 0) {
            if (text[i] === '"') { i++; scanString(false); continue; }
            if (text[i] === '(') depth++;
            else if (text[i] === ')') depth--;
            else if (text[i] === '\n') line++;
            i++;
          }
          continue;
        }
        i += 2;
        continue;
      }
      i++;
    }
    problems.push('unterminated string at EOF');
  }
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text.startsWith('/*', i)) {
      let depth = 0;
      do {
        if (text.startsWith('/*', i)) { depth++; i += 2; }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else { if (text[i] === '\n') line++; i++; }
      } while (depth > 0 && i < text.length);
      continue;
    }
    if (text.startsWith('"""', i)) { i += 3; scanString(true); continue; }
    if (c === '"') { i++; scanString(false); continue; }
    if ('([{'.includes(c)) stack.push({ c, line });
    else if (')]}'.includes(c)) pop(c);
    i++;
  }
  for (const s of stack) problems.push(`unclosed ${s.c} from line ${s.line}`);
  result.balance.push({ path: p, ok: problems.length === 0, problems });
}

// 3. Test inventory across the whole test target, and the specific Quit test names.
const testFiles = walk(join(pkgRoot, 'Tests/Presentation')).filter((p) => p.endsWith('.swift'));
let total = 0;
const perFile = {};
for (const f of testFiles) {
  const n = (readFileSync(f, 'utf8').match(/^\s*@Test\(/gm) || []).length;
  if (n) perFile[rel(f)] = n;
  total += n;
}
const quit = readFileSync(join(pkgRoot, 'Tests/Presentation/QuitTests.swift'), 'utf8');
result.tests = {
  totalTestFunctions: total,
  perFile,
  quitFunctions: [...quit.matchAll(/func (\w+)\(/g)].map((m) => m[1]),
  oldRepeatedQuitPresent: /func repeatedQuit\(\)/.test(quit),
};
const ctl = readFileSync(join(pkgRoot, 'Presentation/LaunchPresentationController.swift'), 'utf8');
result.controller = {
  combinedFinishedQuittingCaseRemoved: !/case \.finished, \.quitting:/.test(ctl),
  quittingPreservesLater: /case \.quitting:\s*\n(\s*\/\/[^\n]*\n)*\s*return awaitingTerminationReply \? \.later : \.now/.test(ctl),
  requestQuitCallSites: (ctl.match(/engine\.requestQuit\(\)/g) || []).length,
  graceScheduleSites: (ctl.match(/PresentationTiming\.quitGrace/g) || []).length,
  surfaceReplySites: (ctl.match(/surface\.replyToTermination\(\)/g) || []).length,
  awaitingTrueAssignments: (ctl.match(/awaitingTerminationReply = true/g) || []).length,
};
console.log(JSON.stringify(result, null, 2));
