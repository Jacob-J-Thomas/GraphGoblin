// Resolve the archived build's workspace packages to that build, and third-party modules to the
// matching already-installed dependencies in this QA worktree. No dependency links are created.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const record=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pr=path.resolve(record,'../../..');
const main=path.join(os.tmpdir(),'gg-qa-426r-main-src');
export async function resolve(specifier,context,nextResolve) {
  if(specifier.startsWith('@graphgoblin/')) {
    const [scope,name,...tail]=specifier.split('/');
    const project=name==='api'?'apps/api':name==='mcp'?'apps/mcp':`packages/${name}`;
    const pkg=JSON.parse(fs.readFileSync(path.join(main,project,'package.json'),'utf8'));
    const exp=pkg.exports[tail.length?'./'+tail.join('/'):'.'];
    const target=typeof exp==='string'?exp:(exp.import ?? exp.default);
    if(!target) throw new Error('Missing baseline export '+specifier);
    return {url:pathToFileURL(path.join(main,project,target)).href,shortCircuit:true};
  }
  if(context.parentURL?.startsWith(pathToFileURL(main+path.sep).href) && !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-z]+:/i.test(specifier)) {
    const original=fileURLToPath(context.parentURL);
    return nextResolve(specifier,{...context,parentURL:pathToFileURL(path.join(pr,path.relative(main,original))).href});
  }
  return nextResolve(specifier,context);
}
