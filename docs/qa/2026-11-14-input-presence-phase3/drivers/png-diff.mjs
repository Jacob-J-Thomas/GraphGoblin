// Pixel diff of two PNGs: dimensions, number of differing pixels and their bounding box (device px).
//   node drivers/png-diff.mjs <a.png> <b.png> [...pairs]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin/apps/web/package.json');
const { PNG } = require('C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/utilsBundle.js');
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const a = PNG.sync.read(readFileSync(args[i]));
  const b = PNG.sync.read(readFileSync(args[i + 1]));
  const name = args[i + 1].split('/').at(-1);
  if (a.width !== b.width || a.height !== b.height) { console.log(`${name}: size ${a.width}x${a.height} vs ${b.width}x${b.height}`); continue; }
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const k = (y * a.width + x) * 4;
    if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] || a.data[k + 2] !== b.data[k + 2] || a.data[k + 3] !== b.data[k + 3]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  console.log(`${name}: ${a.width}x${a.height}, ${n} px differ${n ? ` in box x ${x0}-${x1}, y ${y0}-${y1}` : ''}`);
}
