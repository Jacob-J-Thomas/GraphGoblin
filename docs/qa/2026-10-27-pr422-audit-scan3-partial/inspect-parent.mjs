import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {openReadOnlyDatabaseClient}=await import(pathToFileURL(path.join(process.cwd(),'packages/infrastructure/dist/sqlite/index.js')).href);
const db=openReadOnlyDatabaseClient(path.join(process.env.GG_QA_ROOT,'parent-store','graphgoblin.db'));
try {
 console.log(JSON.stringify((await db.execute('SELECT id,status,parent_run_id,current_node_id,failure,last_event_seq FROM runs')).rows));
 console.log(JSON.stringify((await db.execute("SELECT run_id,seq,type,node_id,payload FROM run_events WHERE type NOT IN ('run.queued','node.progress','node.finished') ORDER BY run_id,seq")).rows));
}finally{db.close();}
