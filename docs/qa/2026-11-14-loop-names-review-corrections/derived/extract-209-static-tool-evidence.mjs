import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-209-review-correction';
const bytes=readFileSync(dir+'/events.jsonl');const calls=new Map();const results=[];
for(const line of bytes.toString('utf8').split('\n')){
 if(!line.trim())continue;let event;try{event=JSON.parse(line);}catch{continue;}
 for(const item of event.message?.content??[]){
  if(item.type==='tool_use'&&item.name==='Bash'&&typeof item.input?.command==='string'&&/typecheck|eslint|prettier|diff --check/.test(item.input.command)){
   calls.set(item.id,{id:item.id,command:item.input.command,description:item.input.description??null});
  }
  if(item.type==='tool_result'&&calls.has(item.tool_use_id)){
   results.push({...calls.get(item.tool_use_id),isError:item.is_error??false,result:item.content});
  }
 }
}
if(!results.length)throw Error('No matching tool results');
const output={provenance:'Derived by selecting only Bash tool-use command/description and its paired tool-result content from the completed run. No model reasoning, signatures or unrelated events included. Original stream retained externally.',sourceSha256:createHash('sha256').update(bytes).digest('hex'),results};
writeFileSync(dir+'/static-command-tool-evidence.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({file:dir+'/static-command-tool-evidence.json',calls:results.map(x=>({description:x.description,isError:x.isError})),sha256:createHash('sha256').update(readFileSync(dir+'/static-command-tool-evidence.json')).digest('hex')}));
