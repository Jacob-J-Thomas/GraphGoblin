import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(here,'evidence-manifest.json'),'utf8'));
for(const item of manifest.files){const b=fs.readFileSync(path.join(here,item.name));if(b.length!==item.bytes||hash(b)!==item.sha256)throw Error('Manifest mismatch '+item.name);}
let checked=0;
for(const name of fs.readdirSync(here)){const p=path.join(here,name);if(!fs.statSync(p).isFile())continue;const b=fs.readFileSync(p);if(b.length>1000000)throw Error('size '+name);if(/\.(json|txt|md|mjs|ps1|cs)$/.test(name)){if(b[0]===239&&b[1]===187&&b[2]===191)throw Error('BOM '+name);const s=new TextDecoder('utf8',{fatal:true}).decode(b);if(s.includes(os.homedir())||s.includes(os.homedir().replaceAll('\\','/'))||/S-1-\d+(?:-\d+)+/.test(s))throw Error('identity '+name);if(name.endsWith('.json'))JSON.parse(s);}checked++;}
const readme=fs.readFileSync(path.join(here,'README.md'),'utf8');
for(const m of readme.matchAll(/\]\(([^)]+)\)/g)){if(!/^(?:https?:|#)/.test(m[1])&&!fs.existsSync(path.resolve(here,m[1])))throw Error('broken link '+m[1]);}
const closure=JSON.parse(fs.readFileSync(path.join(here,'process-closure.json'),'utf8'));if(closure.alive.length)throw Error('processes');
console.log(`PASS final evidence audit: ${checked} files, ${manifest.files.length} verified SHA-256 entries; UTF-8/no BOM, redaction, size, JSON, README links and process closure.`);
