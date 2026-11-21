// QA448 run 06b: remove only owned scratch entries inventoried in observations/06-postchecks.json.
import { readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
const SCRATCH = 'G:/ggq/qa-scratch/i4-448-test-independent-01';
const post = JSON.parse(readFileSync(join(Q, 'observations', '06-postchecks.json'), 'utf8'));
const owned = post.scratch.filter((s) => s.owned && /^(qa448-|tsx-98jak$)/.test(s.name)).map((s) => s.name);
const results = owned.map((name) => {
  try { rmSync(join(SCRATCH, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); return { name, removed: !existsSync(join(SCRATCH, name)) }; }
  catch (e) { return { name, removed: false, error: String(e) }; }
});
const out = { utc: new Date().toISOString(), removed: results, remaining: readdirSync(SCRATCH) };
writeFileSync(join(Q, 'observations', '06b-cleanup.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
