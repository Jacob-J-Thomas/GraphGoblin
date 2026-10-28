import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import * as L from './lib.mjs';
const {createTestApp}=await import(pathToFileURL(path.join(L.ROOT,'apps/api/dist/testing/test-app.js'))),rec=new L.Recorder('sql-scope-review');
const store=fs.mkdtempSync(path.join(os.tmpdir(),'gg-rev205-sql-scope-'));
const t=await createTestApp({tempPrefix:'gg-rev205-sql-helper-',env:{GG_DATA_DIR:store,GG_DB_URL:'file:'+path.join(store,'graphgoblin.db').replaceAll('\\','/')}});
let versionId;
try{
 const definition={...L.single('Authored variable default',L.inferenceNode('work',{model:'gpt-6-luna',effort:'none'})),variables:{payload:{type:'object',default:{effort:'minimal'}}}};
 const created=await t.app.inject({method:'POST',url:'/loops',payload:{definition}});
 rec.check('a current valid definition may contain unrelated user JSON effort minimal',created.statusCode===201,{status:created.statusCode,issues:created.json().issues});versionId=created.json().draft.id;
}finally{await t.close()}
const bullet=fs.readFileSync(path.join(L.ROOT,'CHANGELOG.md'),'utf8').split('\n').find(l=>l.startsWith('- Effort `none`')),
 select=bullet.match(/`(SELECT 'loop_versions'[^`]+);`/)[1],fix=bullet.match(/`(UPDATE loop_versions [^`]+);`/)[1];
await L.withDb(store,async db=>{
 const read=async()=>JSON.parse((await db.execute({sql:'SELECT definition FROM loop_versions WHERE id=?',args:[versionId]})).rows[0].definition);
 const before=await read();rec.log('CHANGELOG inventory identifies this already-valid row',(await db.execute(select)).rows);
 const changed=(await db.execute(fix)).rowsAffected,after=await read();
 rec.log('Documented UPDATE changes user data unrelated to reasoning effort',{changed,canonicalBefore:before.nodes.find(n=>n.id==='work').config.effort,canonicalAfter:after.nodes.find(n=>n.id==='work').config.effort,variableBefore:before.variables.payload.default,variableAfter:after.variables.payload.default});
 rec.check('reproduces unintended rewrite of variable-schema default',before.variables.payload.default.effort==='minimal'&&after.variables.payload.default.effort==='none');
});rec.finish();