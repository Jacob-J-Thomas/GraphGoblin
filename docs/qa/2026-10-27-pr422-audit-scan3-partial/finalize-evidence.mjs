import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const temp = path.join(path.dirname(root), 'gg-audit-422r3-test-temp');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const escapedUser = process.env.USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profileFragment = new RegExp('(?:[A-Za-z]:)?(?:\\\\+|/)Users(?:\\\\+|/)' + escapedUser, 'gi');
const protect = (value) => value
  .replaceAll(process.env.USERPROFILE.replaceAll('\\', '\\\\'), '%USERPROFILE%')
  .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
  .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%')
  .replace(profileFragment, '%USERPROFILE%')
  .replaceAll(os.hostname(), '%COMPUTERNAME%')
  .replace(/S-1-\d+(?:-\d+)+/g, '<SID>');

if (process.argv.includes('--redact')) {
  let changed = 0;
  for (const file of walk(root).filter((p) => /\.(?:md|json|jsonl|txt|mjs|ps1)$/.test(p))) {
    const original = fs.readFileSync(file, 'utf8');
    const sanitized = protect(original);
    if (original !== sanitized) { fs.writeFileSync(file, sanitized, 'utf8'); changed++; }
  }
  const omitted = walk(temp).filter((p) => fs.statSync(p).size > 1_000_000 && /(?:graphgoblin|baseline|\.tar$|\.zip$)/.test(path.basename(p)))
    .map((p) => ({ path: protect(path.relative(path.dirname(root), p)), bytes: fs.statSync(p).size, sha256: sha256(fs.readFileSync(p)) }));
  const rows = omitted.map((f) => `| ${f.path} | ${f.bytes} | ${f.sha256} |`).join('\n');
  fs.writeFileSync(path.join(root, 'NOT-KEPT.md'), '# Not included in the report evidence bundle\n\nNo report capture exceeds 1,000,000 bytes and no compressed trace was retained. The following larger generated baseline archive and disposable runtime data remain outside this report directory; they were not copied into its evidence bundle. Sizes and hashes describe the bytes read at this inventory, not a promise to preserve temporary stores. No deletion was performed.\n\n| Generated file relative to system temp | Bytes | SHA-256 |\n| --- | --- | --- |\n' + rows + '\n', 'utf8');
  console.log(JSON.stringify({redactedFiles:changed,omittedLargeRuntimeFiles:omitted.length}));
}

if (process.argv.includes('--manifest')) {
  const exclusions = ['artifact-manifest.json', 'evidence-validation.log.txt', 'manifest-format.log.txt'];
  const files = walk(root).filter((p) => !exclusions.includes(path.basename(p))).map((p) => {
    const bytes = fs.readFileSync(p);
    return {path:path.relative(root,p).replaceAll('\\','/'),bytes:bytes.length,sha256:sha256(bytes)};
  }).sort((a,b)=>a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(root,'artifact-manifest.json'),JSON.stringify({head:'ef349181691a97b1fbe0d50a7ed8b4a4ba01175e',target:'35576b4a582b07b9d0f72e6d5ca80928591de393',capturedAt:new Date().toISOString(),exclusions,files},null,2)+'\n','utf8');
  console.log(JSON.stringify({manifestFiles:files.length}));
}

if (process.argv.includes('--validate')) {
  const problems=[];
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for (const file of walk(root)) {
    const bytes=fs.readFileSync(file);
    if(bytes.length>1_000_000||/\.(zip|gz|tgz)$/i.test(file))problems.push('oversize/compressed: '+path.basename(file));
    if(!/\.(?:md|json|jsonl|txt|mjs|ps1)$/.test(file))continue;
    let content;
    try {content=decoder.decode(bytes);} catch {problems.push('not UTF-8: '+path.basename(file));continue;}
    if(content.includes(process.env.USERPROFILE)||content.includes(os.hostname())||profileFragment.test(content)||/S-1-\d+(?:-\d+)+/.test(content))problems.push('redaction: '+path.basename(file));
    profileFragment.lastIndex=0;
    if(file.endsWith('.json')) {try{JSON.parse(content);}catch{problems.push('JSON: '+path.basename(file));}}
  }
  const report=fs.readFileSync(path.join(root,'REPORT.md'),'utf8');
  if(report.includes('FINAL_GATE_PENDING'))problems.push('report has pending gate');
  if((report.match(/^## /gm)||[]).length!==7)problems.push('report section count');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'artifact-manifest.json'),'utf8'));
  for(const item of manifest.files){const bytes=fs.readFileSync(path.join(root,item.path));if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)problems.push('hash: '+item.path);}
  console.log(JSON.stringify({validatedFiles:manifest.files.length,problems}));
  if(problems.length)process.exitCode=1;
}
