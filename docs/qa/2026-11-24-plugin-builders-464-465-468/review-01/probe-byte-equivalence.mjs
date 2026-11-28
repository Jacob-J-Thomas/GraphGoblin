import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=process.cwd();
const require=createRequire(join(repo,'package.json'));
const ts=require('typescript');
const helper=pathToFileURL(join(repo,'tooling/plugin-output.mjs')).href;
const manifest=pathToFileURL(join(repo,'apps/plugin-codex/dist/manifest.js')).href;
async function load(path,baseline){
 const source=baseline?execFileSync('git',['show',`HEAD:${path}`],{cwd:repo,encoding:'utf8'}):await fs.readFile(join(repo,path),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll("'@graphgoblin/tooling/plugin-output'",JSON.stringify(helper)).replaceAll("'./manifest.js'",JSON.stringify(manifest));
 return import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
}
const scratch=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'gg-review-bytes-'));
const codexPackage=join(scratch,'fixture apps','plugin-codex');
const claudePackage=join(scratch,'fixture apps','plugin-claude');
await fs.mkdir(codexPackage,{recursive:true});
await fs.mkdir(claudePackage,{recursive:true});
await fs.cp(join(repo,'apps/plugin-codex/plugin'),join(codexPackage,'plugin'),{recursive:true});
await fs.cp(join(repo,'apps/plugin-claude/plugin'),join(claudePackage,'plugin'),{recursive:true});
await fs.copyFile(join(repo,'apps/plugin-claude/README.md'),join(claudePackage,'README.md'));
const mcpEntry=join(scratch,'entry 漢 space','main.js');
await fs.mkdir(join(scratch,'entry 漢 space'),{recursive:true});
await fs.writeFile(mcpEntry,'');
async function snapshot(root){
 const result={};
 for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;
  const path=join(entry.parentPath,entry.name);
  result[relative(root,path).split(sep).join('/')]=createHash('sha256').update(await fs.readFile(path)).digest('hex');
 }
 return result;
}
const evidence=[];
for(const [name,path,invoke] of [
 ['codex','apps/plugin-codex/src/assemble.ts',(mod,outDir)=>mod.assemblePlugin({pluginDir:join(codexPackage,'plugin/graphgoblin'),outDir,mcpEntry})],
 ['claude','apps/plugin-claude/src/index.ts',(mod,outDir)=>mod.assembleClaudePlugin(claudePackage,{outDir,mcpEntry})],
]){
 const baseline=await load(path,true);
 const candidate=await load(path,false);
 const oldOut=join(scratch,`${name} baseline`);
 const newOut=join(scratch,`${name} candidate`);
 await invoke(baseline,oldOut);
 await invoke(candidate,newOut);
 const oldFiles=await snapshot(oldOut),newFiles=await snapshot(newOut);
 assert.deepEqual(newFiles,oldFiles);
 evidence.push({builder:name,comparison:'baseline source versus frozen candidate source, public assemblers transpiled without editing repository',generatedFileCount:Object.keys(newFiles).filter(file=>file!=='.graphgoblin-plugin-output.json').length,ownershipMarkerIncluded:true,allFileBytesIdentical:true,files:newFiles});
}
console.log(JSON.stringify(evidence,null,2));
await fs.rm(scratch,{recursive:true,force:true});
