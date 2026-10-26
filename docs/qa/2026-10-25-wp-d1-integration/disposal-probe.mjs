import {openDatabase,openReadOnlyDatabaseClient} from 'file:///%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-d1-integrate/packages/infrastructure/dist/sqlite/index.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for (const reads of [0,1,1000,30000]) {
 const dir=await mkdtemp(join(tmpdir(),'gg-wp-d1-int-dispose-probe-'));
 const file=join(dir,'graphgoblin.db');
 const handle=openDatabase({url:'file:'+file.replaceAll('\\','/')});
 await handle.client.execute('CREATE TABLE probe (id INTEGER)');
 handle.close();
 if(reads){ const observer=openReadOnlyDatabaseClient(file); for(let i=0;i<reads;i++) await observer.execute('SELECT * FROM probe'); observer.close(); }
 const started=performance.now();
 let result='removed';
 try {await rm(dir,{recursive:true,force:true,maxRetries:0});} catch(e){result=e.code;}
 console.log(JSON.stringify({reads,phase:'before-gc',result,ms:performance.now()-started}));
 if(result!=='removed') {globalThis.gc(); const at=performance.now(); await rm(dir,{recursive:true,force:true,maxRetries:0}); console.log(JSON.stringify({reads,phase:'after-gc',result:'removed',ms:performance.now()-at}));}
}
