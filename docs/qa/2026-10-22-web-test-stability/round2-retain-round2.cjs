const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.cwd(), temp = process.env.TEMP, out = path.join(root,'docs/qa/2026-10-22-web-test-stability');
const manifest=path.join(out,'round2-evidence-provenance.json');
const entries=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8')):[];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function redact(bytes) {
  for (const prefix of [process.env.USERPROFILE,process.env.USERPROFILE.replaceAll('\\','/'),process.env.USERPROFILE.replaceAll('\\','\\\\'),process.env.USERNAME]) {
    for (const encoding of ['utf8','utf16le']) {
      const needle=Buffer.from(prefix,encoding), replacement=Buffer.from('<USERPROFILE>',encoding);
      let at; while((at=bytes.indexOf(needle))!==-1) bytes=Buffer.concat([bytes.subarray(0,at),replacement,bytes.subarray(at+needle.length)]);
    }
  }
  return bytes;
}
function retain(source,destination) {
  const original=fs.readFileSync(source), retained=redact(original);
  const name=path.relative(out,destination).replaceAll('\\','/');
  const previous=entries.findIndex(entry=>entry.name===name);
  if(source===destination&&previous!==-1&&sha(original)===entries[previous].retainedSha256)return;
  fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.writeFileSync(destination,retained);
  const entry={name,originalSha256:sha(original),retainedSha256:sha(retained)};
  if(previous===-1)entries.push(entry);else entries[previous]=entry;
}
for(const name of fs.readdirSync(temp)) if(/^gg-chore-web-round2-.*\.(log\.txt|json)$/.test(name)) retain(path.join(temp,name),path.join(out,name));
for(const name of fs.readdirSync(path.join(temp,'gg-chore-web-round2-before'))) retain(path.join(temp,'gg-chore-web-round2-before',name),path.join(out,'round2-before',name));
if(!process.argv.includes('--probes'))for(const name of fs.readdirSync(path.join(out,'round2-after'))) retain(path.join(out,'round2-after',name),path.join(out,'round2-after',name));
for(const name of fs.readdirSync(out))if(/^gg-chore-web-extra.*\.ts$/.test(name))retain(path.join(out,name),path.join(out,name));
if(fs.existsSync(path.join(out,'browser-extra-first')))for(const name of fs.readdirSync(path.join(out,'browser-extra-first')))retain(path.join(out,'browser-extra-first',name),path.join(out,'browser-extra-first',name));
for(const name of ['status.config.mjs','readiness.config.mjs','strengthen.cjs','byte-probe.cjs','evidence-bytes.cjs','gates.cjs','assertions.cjs','retain.cjs','retain-round2.cjs','source-record.cjs','verify-sources.cjs','summary-round2.cjs','browser-extra.cjs','extract-control.ps1','finish-check.cjs','probe-ports.cjs']) retain(path.join(temp,'gg-chore-web-'+name),path.join(out,'round2-'+name));
fs.writeFileSync(manifest,JSON.stringify(entries,null,2)+'\n');
console.log('Retained/redacted',entries.length,'round 2 artifacts.');
