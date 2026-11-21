import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const cwd='G:/ggq/gg-i4-427-guide/GraphGoblin', base='f96a4073c3b53af7724d1ef5593eeaf03194c4cd';
const ts=createRequire(join(cwd,'package.json'))('typescript');
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={node:process.version,typescript:ts.version,base,files:{}};
for(const file of ['packages/adapter-codex/src/options.ts','packages/adapter-codex/src/isolation.ts']){
 const before=execFileSync('git',['show',base+':'+file],{cwd,encoding:'utf8',windowsHide:true});
 const after=readFileSync(join(cwd,file),'utf8');
 const emit=s=>ts.transpileModule(s,{compilerOptions:{removeComments:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext}}).outputText;
 const a=emit(before),b=emit(after);if(a!==b)throw Error('Runtime changed: '+file);
 result.files[file]={sourceBefore:sha(before),sourceAfter:sha(after),emittedBefore:sha(a),emittedAfter:sha(b),equal:true};
}
writeFileSync('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-427-365-correction-01/comment-proof.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify(result)+'\n');
