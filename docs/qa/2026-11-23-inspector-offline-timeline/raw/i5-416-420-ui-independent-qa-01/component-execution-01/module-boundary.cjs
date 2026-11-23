const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {createRequire}=require('node:module');
const root='G:/ggq/gg-i5-offline-ui-qa/GraphGoblin';const label=process.argv[2];
if(!['before','after'].includes(label))throw new Error('Explicit boundary label required');
if(process.version!=='v22.23.4')throw new Error('Admitted project Node22.23.4 required');
const destination=path.join(__dirname,label+'.modules.json');if(fs.existsSync(destination))throw new Error('Boundary already exists');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const req=createRequire(path.join(root,'apps/web/package.json'));
const selected=['react','react-dom','@tanstack/react-query','@testing-library/react','vitest','jsdom','typescript','zod','@playwright/test','prettier'].map(name=>{
  const entry=req.resolve(name);let dir=path.dirname(fs.realpathSync(entry));while(!fs.existsSync(path.join(dir,'package.json')))dir=path.dirname(dir);
  const manifest=path.join(dir,'package.json');return{name,entry,realEntry:fs.realpathSync(entry),entrySha256:sha(entry),manifest,manifestSha256:sha(manifest),version:JSON.parse(fs.readFileSync(manifest,'utf8')).version};
});
const queryCore=createRequire(req.resolve('@tanstack/react-query')).resolve('@tanstack/query-core');
selected.push({name:'@tanstack/query-core',entry:queryCore,realEntry:fs.realpathSync(queryCore),entrySha256:sha(queryCore)});
const result={label,utc:new Date().toISOString(),node:{version:process.version,path:process.execPath,sha256:sha(process.execPath)},selected,limit:'Read-only selected resolved module/file identity. No modules imported as application/test code; not exhaustive installation identity.'};
fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
