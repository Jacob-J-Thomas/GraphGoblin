// Reviewer check (WP-425 scan 2): the private Obstacles grid in edge-label-placement.ts, compiled
// from the source text itself (no copy), against a brute-force overlap scan. Random boxes span
// negative coordinates, exact 256 px cell boundaries and boxes several cells wide.
// Run: pnpm --filter @graphgoblin/web exec tsx --conditions=development <this file>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const web = join(root, 'apps', 'web');
const source = readFileSync(join(web, 'src', 'editor', 'edge-label-placement.ts'), 'utf8');
const start = source.indexOf('class Obstacles');
const end = source.indexOf('\n}\n', start) + 2;
const classText = source.slice(start, end);
const ts = createRequire(join(web, 'package.json'))('typescript') as typeof import('typescript');
const js = ts.transpileModule(classText, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const geometry = (await import(
  pathToFileURL(join(web, 'src', 'editor', 'routing-geometry.ts')).href
)) as typeof import('../../../../../apps/web/src/editor/routing-geometry.js');
type Box = { id: string; left: number; right: number; top: number; bottom: number };
const Obstacles = new Function('overlapsBox', `${js}\nreturn Obstacles;`)(geometry.overlapsBox) as new (
  boxes: readonly Box[],
) => { add(box: Box): void; query(box: Box): Box[] };

let seed = 425;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
const coordinate = () =>
  pick([
    () => Math.round((random() - 0.5) * 4000),
    () => pick([-512, -256, 0, 256, 512, 768, 1024]) + pick([-1, -0.5, 0, 0.5, 1]),
    () => (random() - 0.5) * 4000,
  ])();
const box = (id: string): Box => {
  const left = coordinate();
  const top = coordinate();
  const width = pick([0, 1, 20, 255, 256, 257, 600, 1500]) * (random() < 0.9 ? 1 : random());
  const height = pick([0, 1, 22, 120, 256, 700]) * (random() < 0.9 ? 1 : random());
  return { id, left, top, right: left + width, bottom: top + height };
};
let queries = 0;
let mismatches = 0;
const examples: unknown[] = [];
for (let round = 0; round < 200; round += 1) {
  const boxes = Array.from({ length: 1 + Math.floor(random() * 120) }, (_, i) => box(`b${i}`));
  const half = Math.floor(boxes.length / 2);
  const grid = new Obstacles(boxes.slice(0, half));
  for (const b of boxes.slice(half)) grid.add(b); // labels join the grid after construction
  for (let q = 0; q < 50; q += 1) {
    const probe = box(`q${q}`);
    const expected = boxes.filter((b) => geometry.overlapsBox(probe, b)).map((b) => b.id).sort();
    const found = grid.query(probe).map((b) => b.id).sort();
    queries += 1;
    if (expected.join() !== found.join()) {
      mismatches += 1;
      if (examples.length < 5) examples.push({ probe, expected, found });
    }
  }
}
console.log(JSON.stringify({ classLines: classText.split('\n').length, queries, mismatches, examples }, null, 2));
