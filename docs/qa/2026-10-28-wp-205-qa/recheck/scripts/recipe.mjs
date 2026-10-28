// Read only the published CHANGELOG, never the implementer record's SQL generator or copy.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import*as L from'./qa.mjs';
const change=fs.readFileSync(path.join(L.ROOT,'CHANGELOG.md'),'utf8');const bullet=change.indexOf('- Effort `none` (no reasoning)');const open=change.indexOf('  ```sql',bullet);const close=change.indexOf('  ```',open+9);
if(open<0||close<0)throw new Error('No shipped SQL block');
export const recipe=change.slice(change.indexOf('\n',open)+1,close).split('\n').map(l=>l.replace(/^  /,'')).join('\n');
export const discovery=recipe.split('-- 2.')[0].replace(/^--[^\n]*\n/,'').trim();
export const updates='-- 2.'+recipe.split('-- 2.')[1];
if(!discovery.startsWith('SELECT')||!updates.includes('UPDATE run_events'))throw new Error('Recipe extraction failed');
fs.writeFileSync(path.join(L.OUT,'changelog-verbatim.sql.txt'),recipe);
export const recipeHash=createHash('sha256').update(recipe).digest('hex');
export async function find(dir){return L.sql(dir,discovery).then(r=>r.rows.map(r=>({place:r.place,ref:r.ref})));}
export async function repair(dir){return L.withDb(dir,db=>db.executeMultiple(updates));}
