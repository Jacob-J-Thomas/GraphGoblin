import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const cfg=JSON.parse(readFileSync(process.argv[2],'utf8'));
const git=(...args)=>execFileSync('git',['-C',cfg.checkout,...args],{maxBuffer:150*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const line=(...args)=>git(...args).toString().trim(), sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(line('rev-parse','HEAD')!==cfg.head||line('status','--porcelain'))throw Error('Unfrozen checkout');
mkdirSync(cfg.output,{recursive:true});
const paths=git('diff','--name-only','-z',cfg.base,cfg.head).toString().split('\0').filter(Boolean);
const nonQa=paths.filter(p=>!p.startsWith('docs/qa/'));
const records=[];
for(const path of paths){
  const exists=git('ls-tree',cfg.head,'--',path).length>0;
  if(!exists){records.push({path,deleted:true});continue;}
  const bytes=git('show',`${cfg.head}:${path}`);
  records.push({path,bytes:bytes.length,sha256:sha(bytes),gitBlob:line('rev-parse',`${cfg.head}:${path}`)});
}
const diff=git('diff','--binary',cfg.base,cfg.head,'--','.',':!docs/qa');
writeFileSync(cfg.output+'/non-qa.diff',diff);
writeFileSync(cfg.output+'/non-qa-paths.txt',nonQa.join('\n')+'\n');
const fullPath=cfg.output+'/exact.diff',fd=openSync(fullPath,'w');
try{execFileSync('git',['-C',cfg.checkout,'diff','--binary',cfg.base,cfg.head],{stdio:['ignore',fd,'pipe'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});}finally{closeSync(fd);}
const full=readFileSync(fullPath);
const tree=line('rev-parse','HEAD^{tree}');
const identity={at:new Date().toISOString(),pr:cfg.pr,checkout:cfg.checkout,head:cfg.head,tree,base:cfg.base,branch:line('branch','--show-current'),clean:true,changedPaths:paths.length,nonQaPaths:nonQa.length,nonQaDiff:{bytes:diff.length,sha256:sha(diff)},fullDiff:{bytes:full.length,sha256:sha(full)},nativeSourceHead:cfg.nativeSourceHead};
writeFileSync(cfg.output+'/identity.json',JSON.stringify(identity,null,2)+'\n');
writeFileSync(cfg.output+'/source-and-evidence-readback.json',JSON.stringify({identity,files:records},null,2)+'\n');
console.log(JSON.stringify(identity));
