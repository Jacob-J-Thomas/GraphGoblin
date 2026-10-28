import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const root=process.cwd(),scratch=path.join(os.tmpdir(),'gg-rev205c-review'),src=path.join(root,'docs/qa/2026-10-28-wp-205-none/review2-scripts');
for(const n of ['lib.mjs','recipe.mjs','build-base.mjs','base-history.mjs','base-missing.mjs','sql-checks.mjs','real-guards.mjs','verify-own.mjs','verify-scope-bytes.mjs'])fs.writeFileSync(path.join(scratch,n),fs.readFileSync(path.join(src,n),'utf8').replaceAll('gg-rev205b-','gg-rev205c-'));
fs.mkdirSync(path.join(scratch,'evidence'),{recursive:true});console.log('Prepared original scan-2 drivers with scan-3 locations/prefix only.');
