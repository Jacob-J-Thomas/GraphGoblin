// Copy prior independent QA drivers into this record. No product files are edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.dirname(here);
const prior=path.resolve(out,'../2026-10-27-pr426-qa-recheck/scripts');
const audit=path.join(os.homedir(),'.claude/codex-runs/GraphGoblin/audit-reports/pr426-scan3-evidence');
const provenance=[];
function copy(root,name,change=x=>x) {
  const bytes=fs.readFileSync(path.join(root,name));
  let text=change(bytes.toString('utf8'));
  text=text.replaceAll('gg-qa-426r-','gg-qa-426f-').replaceAll('gg-audit-426r3-','gg-qa-426f-scan3-');
  text=text.replace(/\b671([0-9])\b/g,(_,n)=>String(6730+Number(n))).replaceAll('6723','6733');
  // Strip all inherited gateway/provider settings before adding our controlled settings.
  text=text.replaceAll('v !== undefined && ![','v !== undefined && !key.toUpperCase().startsWith("GG_") && ![');
  text=text.replaceAll('v!==undefined&&![','v!==undefined&&!k.toUpperCase().startsWith("GG_")&&![');
  text=text.replaceAll('v !== undefined && !key.toUpperCase()', 'v !== undefined && !key.toUpperCase()');
  // The spaced variants use k, except probe-errors, which uses key.
  if(name!=='probe-errors.mjs') text=text.replaceAll('!key.toUpperCase().startsWith("GG_")','!k.toUpperCase().startsWith("GG_")');
  text=text.replaceAll('await t.close();','await t.app.close(); await t.container.dispose(); /* retain disposable directory; no deletion */');
  for(const log of ['mixed-causes','durable-http','extended-order-matrix','order-matrix','error-probes']) text=text.replaceAll(`new URL('./${log}.log.txt'`,`new URL('../${log}.log.txt'`);
  fs.writeFileSync(path.join(here,name),text,'utf8');
  provenance.push({source:(root===audit?'audit scan 3 evidence/':'prior QA recheck scripts/')+name,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),copy:name});
}
for(const name of ['lib.mjs','c1-catalog.mjs','c1-upgrade.mjs','c4-regression.mjs','settings.mjs','review-runs.mjs','fake-cli.cs.txt','baseline-loader.mjs','build-baseline.mjs']) copy(prior,name,text=>{
  if(name==='lib.mjs') text=text.replace('t = t.replace(/<SID>-[0-9-]+/g,', 't = t.replace(/S-1-(?:\\d+-)+\\d+/g,');
  if(name==='fake-cli.cs.txt') text=text.replace('    var session = Guid.NewGuid().ToString();',`    if (!claude && mode == "spec") {
      foreach (var line in File.ReadAllLines(Path.Combine(dir, "spec-events.txt"))) Out(line);
      Console.Error.Write(File.ReadAllText(Path.Combine(dir, "spec-stderr.txt"))); Console.Error.Flush();
      return int.Parse(File.ReadAllText(Path.Combine(dir, "spec-exit.txt")).Trim());
    }
    var session = Guid.NewGuid().ToString();`);
  return text;
});
for(const name of ['mixed-causes.mjs','durable-http.mjs','extended-order-matrix.mjs','order-matrix.mjs','fixture-cli.mjs','order-cli.mjs','probe-errors.mjs','fake-codex.mjs']) copy(audit,name);
const tools=path.join(os.tmpdir(),'gg-qa-426f-tools');
fs.mkdirSync(path.join(tools,'fake'),{recursive:true});
fs.copyFileSync(path.join(here,'fake-cli.cs.txt'),path.join(tools,'fake-cli.cs'));
fs.writeFileSync(path.join(out,'driver-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log('Prepared '+provenance.length+' drivers/fixtures; no dependency installs or links.');
