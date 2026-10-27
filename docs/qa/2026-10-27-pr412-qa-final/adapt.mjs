// Copy historical QA harnesses; never change historical records or product code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const wt = path.resolve(here, '../../..');
const other = path.resolve(wt, '..', 'agent-a67e9f5737ee26db3/docs/qa');
const sources = {
  '2026-10-26-wp-e3-412-qa-recheck-2': ['qa-lib.mjs','qa-server.mjs','qa-server-main.mjs','template-unknown.mjs','datadir-alias.mjs','artifact-alias.mjs','interrupt-phases.mjs','realistic.mjs','migrated.mjs','mkstore-main.mjs','r3-focus.mjs','inspect-db.py','refs-dump.py','realistic-verify.py','ui-edge.mjs','ui-edge-2.mjs'],
  '2026-10-26-wp-e3-412-qa-recheck': ['startup-latency.mjs','latency.mjs','d1-repro.mjs','d1-cursors.mjs','integrated.mjs','ui-edge-3.mjs'],
};
if (fs.readdirSync(os.tmpdir()).some(x=>x.startsWith('gg-qa-412f-a-'))) throw Error('Refusing fixture reuse');
const manifest=[];
for (const [dir,names] of Object.entries(sources)) for(const name of names){
  const src=path.join(other,dir,name);
  let s=fs.readFileSync(src,'utf8').replace(/^\uFEFF/,'');
  s=s.replaceAll('gg-qa-e3r-','gg-qa-412f-a-').replaceAll('gg-qa-e3-','gg-qa-412f-a-');
  s=s.replace(/\b65[678](\d)\b/g,(_,n)=>'662'+n);
  s=s.replace(/^.*\bfs\.rmSync\([^\n]+\);\r?\n/gm,'// Fixture is unique. Leave all directories for the orchestrator.\n');
  s=s.replace(/shutil\.rmtree\(scratch, ignore_errors=True\)/g,'pass  # Leave read-only inspection copies for the orchestrator.');
  s=s.replaceAll("'server.log'","'server.log.txt'").replaceAll("'server-main.log'","'server-main.log.txt'");
  fs.writeFileSync(path.join(here,name),s,'utf8');
  manifest.push({source:dir+'/'+name,copy:name});
}
fs.writeFileSync(path.join(here,'copied-harnesses.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Copied',manifest.length,'QA scripts; unique fixture prefix gg-qa-412f-a-, allowed ports, no recursive fixture deletion.');
