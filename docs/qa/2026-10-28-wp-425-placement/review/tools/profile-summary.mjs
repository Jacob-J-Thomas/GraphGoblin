// Summarise a Chrome CPU profile of the web bundle: self time per original source file and
// function, mapped through the bundle's source map. node profile-summary.mjs <cpuprofile> <dist>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  '%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/agent-ac1d90d26b904089d/node_modules/.pnpm/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping/package.json',
);
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
const [profileFile, dist] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
const assets = path.join(dist, 'assets');
const js = fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
const map = new TraceMap(fs.readFileSync(path.join(assets, js + '.map'), 'utf8'));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i += 1) {
  const n = byId.get(profile.samples[i]);
  self.set(n.id, (self.get(n.id) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const byFile = new Map();
const byFunction = new Map();
for (const [id, us] of self) {
  const f = byId.get(id).callFrame;
  let file = f.url ? path.basename(f.url) : `(${f.functionName || 'native'})`;
  let fn = f.functionName || '(anonymous)';
  if (f.url.includes(js) && f.lineNumber >= 0) {
    const o = originalPositionFor(map, { line: f.lineNumber + 1, column: f.columnNumber });
    if (o.source) {
      file = o.source.replace(/^.*?(apps\/web\/src\/|node_modules\/\.pnpm\/)/, '$1').replace(/^node_modules\/\.pnpm\/[^/]+\/node_modules\//, '');
      fn = `${file}:${o.line}${o.name ? ' ' + o.name : ''}`;
    }
  }
  byFile.set(file, (byFile.get(file) ?? 0) + us);
  byFunction.set(fn, (byFunction.get(fn) ?? 0) + us);
}
const top = (m, n) =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms ${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
console.log(`profile ${path.basename(profileFile)}: ${(total / 1000).toFixed(0)} ms sampled`);
console.log('-- self time by source file');
console.log(top(byFile, 15).join('\n'));
console.log('-- self time by function (source line)');
console.log(top(byFunction, 20).join('\n'));
