import { readFileSync, writeFileSync } from 'node:fs';
const path = 'G:/ggq/gg-i4-486-review-fixes/GraphGoblin/packages/engine/src/handlers/inference-context.test.ts';
const original = readFileSync(path, 'utf8');
const start = original.indexOf("it('preserves the private canonical diagnostic when reconstruction attaches prior task provenance'");
const end = original.indexOf('async function options()', start);
if (start < 0 || end < start) throw new Error('expected fixture block missing');
writeFileSync('G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-review-fixes-author-01/fixture-03-before.ts', original);
writeFileSync(path, (original.slice(0, start) + original.slice(end)).replace("import { defaultHandlers } from './index.js';\n", ''));
