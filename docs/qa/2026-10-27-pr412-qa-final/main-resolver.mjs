import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const cfg=JSON.parse(fs.readFileSync(new URL('./main-build.json',import.meta.url)));
for(const p of Object.values(cfg.packages)){p.dir=p.dir.replaceAll('%USERPROFILE%',process.env.USERPROFILE);p.current=p.current.replaceAll('%USERPROFILE%',process.env.USERPROFILE);}
export async function resolve(specifier, context, nextResolve){
  if(specifier.startsWith('@graphgoblin/')){
    const parts=specifier.split('/'), name=parts.slice(0,2).join('/'), key=parts.length===2?'.':'./'+parts.slice(2).join('/');
    const p=cfg.packages[name];
    if(p){const exp=p.exports[key]; const target=typeof exp==='string'?exp:exp.import; return {url:pathToFileURL(path.join(p.dir,target)).href,shortCircuit:true};}
  }
  if(!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:') && !specifier.startsWith('file:') && context.parentURL?.startsWith('file:')){
    const parent=fileURLToPath(context.parentURL);
    const owner=Object.values(cfg.packages).find(p=>parent.startsWith(p.dir+path.sep));
    if(owner) return nextResolve(specifier,{...context,parentURL:pathToFileURL(path.join(owner.current,'package.json')).href});
  }
  return nextResolve(specifier,context);
}
