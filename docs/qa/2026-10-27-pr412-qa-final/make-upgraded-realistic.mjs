// Reuse the same 488-run public API scenario in the real main-created/upgraded store.
import fs from 'node:fs';
import {here,join} from './qa-lib.mjs';
let s=fs.readFileSync(join(here,'realistic.mjs'),'utf8');
s=s.replace("new Evidence('06-realistic')","new Evidence('06b-realistic-upgraded')")
 .replace("join(temp, 'gg-qa-412f-a-real')","join(temp, 'gg-qa-412f-b-mig')")
 .replace('port: 6628','port: 6628')
 .replace('try {\n  // ------------------------------------------------------------------ loops',"const legacy=(await api.listAll(500)).flat();\nconst legacyRecords=await Promise.all(legacy.map(id=>api.run(id)));\nev.log('Retained existing main/upgrade history',legacy);\ntry {\n  // ------------------------------------------------------------------ loops")
 .replace('const allRuns = new Set([...approved, ...retained]);','const allRuns = new Set([...approved, ...retained]);')
 .replace('  // Unrelated and look-alike files',"  for(const id of legacy) allRuns.add(id);\n  // Unrelated and look-alike files")
 .replace('const missing = retained.filter((id) => !listed.has(id));','const missing = [...retained,...legacy].filter((id) => !listed.has(id));')
 .replace('finalPages.flat().length === retained.length && new Set(finalPages.flat()).size === retained.length','finalPages.flat().length === retained.length+legacy.length && new Set(finalPages.flat()).size === retained.length+legacy.length')
 .replace("  // ------------------------------------------------------------------ phase C: configured parent-directory alias", "  const legacyAfter=await Promise.all(legacy.map(id=>api.run(id)));\n  ev.check('all original main/upgrade run snapshots are identical after realistic cleanup',JSON.stringify(legacyAfter)===JSON.stringify(legacyRecords));\n  // ------------------------------------------------------------------ phase C: configured parent-directory alias");
fs.writeFileSync(join(here,'realistic-upgraded.mjs'),s,'utf8');
console.log('Wrote upgraded-store version; baseline runs included in paging and retained snapshot audit.');
