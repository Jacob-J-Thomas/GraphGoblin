// Supplemental SQLite plans on our stopped 100,099-decision fixture.
// observation-cost.mjs preserves the review's old unhinted query in its `plan` field;
// these use the new evidence indexes and their matching partial-index conditions.
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createRequire} from 'node:module';
import {HERE,ROOT} from './lib.mjs';
const require=createRequire(join(ROOT,'packages/infrastructure/package.json'));
const {createClient}=require('@libsql/client');
const ledger=(await readFile(join(HERE,'processes.log.txt'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
const fixture=ledger.findLast(x=>x.port===6614);if(!fixture)throw new Error('Missing owned fixture');
const dir=fixture.dataDir.replaceAll('%USERPROFILE%',process.env.USERPROFILE);
const uri='file:'+join(dir,'graphgoblin.db').replaceAll('\\','/')+'?mode=ro';
const db=createClient({url:'file:'+encodeURIComponent(uri)});
try{
  const id=(await db.execute('SELECT id FROM runs LIMIT 1')).rows[0].id,result={};
  for(const [index,type,field] of [['run_events_gate_idx','decision.made','gate'],['run_events_fresh_session_idx','run.resumed','freshSession']]){
    const query=`SELECT seq,payload FROM run_events INDEXED BY ${index} WHERE run_id=? AND "run_events"."type"='${type}' AND CASE WHEN json_valid("run_events"."payload") THEN json_type("run_events"."payload",'$.${field}') IS NOT NULL ELSE 1 END ORDER BY seq DESC LIMIT ${field==='gate'?1:20}`;
    result[index]={query,plan:(await db.execute({sql:`EXPLAIN QUERY PLAN ${query}`,args:[id]})).rows,results:(await db.execute({sql:query,args:[id]})).rows};
  }
  await writeFile(join(HERE,'index-plans.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{db.close();}
