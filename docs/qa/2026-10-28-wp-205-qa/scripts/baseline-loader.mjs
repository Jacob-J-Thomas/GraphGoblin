import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const record=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(record,'../../..');
const {main}=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'gg-qa205-state.json'),'utf8'));
export async function resolve(specifier,context,nextResolve) {
 if(specifier.startsWith('@graphgoblin/')) {
  const [,name,...tail]=specifier.split('/');const project=name==='api'?'apps/api':`packages/${name}`;
  const pkg=JSON.parse(fs.readFileSync(path.join(main,project,'package.json'),'utf8'));
  const exp=pkg.exports[tail.length?'./'+tail.join('/'):'.'];const target=typeof exp==='string'?exp:(exp.import??exp.default);
  if(!target)throw new Error('Missing baseline export '+specifier);
  return {url:pathToFileURL(path.join(main,project,target)).href,shortCircuit:true};
 }
 if(context.parentURL?.startsWith(pathToFileURL(main+path.sep).href)&&!specifier.startsWith('.')&&!specifier.startsWith('/')&&!/^[a-z]+:/i.test(specifier))return nextResolve(specifier,{...context,parentURL:pathToFileURL(path.join(root,path.relative(main,fileURLToPath(context.parentURL)))).href});
 return nextResolve(specifier,context);
}
