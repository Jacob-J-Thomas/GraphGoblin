import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as L from './lib.mjs';
const {openDatabase}=await import(pathToFileURL(path.join(L.REPO,'packages/infrastructure/dist/sqlite/index.js')).href);
const evidence={};
let api,db;
const marker=path.join(L.ROOT,'projection-effects');
const release=path.join(L.ROOT,'projection-script-release');
const count=()=>fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n').filter(Boolean).length:0;
try{
 api=await L.startApi('projection-store',6660,{GG_AUDIT_REPO:L.REPO},path.join(L.RECORD,'failure-projection.fixture.mjs'));
 db=openDatabase({url:'file:'+path.join(api.dir,'graphgoblin.db')});
 await db.client.execute("CREATE TRIGGER audit_refuse_progress BEFORE INSERT ON run_events WHEN NEW.type='node.progress' AND NEW.node_id='effect' BEGIN SELECT RAISE(ABORT,'audit progress acknowledgement lost'); END");
 const id=await L.publish(api,L.loop('Failure projection interleaving',[L.scriptNode(path.join(L.RECORD,'effect.mjs'),['exit',marker,release],'effect')]));
 const source=await L.run(api,id);
 const committed=path.join(api.dir,'failure-committed.json');
 await L.until(()=>fs.existsSync(committed));
 const event=JSON.parse(fs.readFileSync(committed,'utf8'));
 assert.equal(event.failure.code,'SCRIPT_OUTCOME_UNCERTAIN');assert.equal(count(),1);
 const snapshot=await api.get(`/runs/${source.id}`);
 assert.equal(snapshot.status,'running');assert.equal(snapshot.recovery.observedSeq,event.seq);
 assert.equal(snapshot.recovery.replayDefault.code,'RECOVERY_STALE');
 assert.equal(snapshot.recovery.scriptConsent,undefined);
 evidence.before={event,snapshot,effects:count()};
 await db.client.execute('DROP TRIGGER audit_refuse_progress');
 fs.writeFileSync(release,'fixed');
 const replay=await api.call('POST',`/runs/${source.id}/replay`,{nodeId:'effect',observedSeq:snapshot.recovery.observedSeq});
 assert.equal(replay.status,409,JSON.stringify(replay));assert.equal(replay.body.code,'RECOVERY_STALE');assert.equal(count(),1);
 fs.writeFileSync(path.join(api.dir,'release-failure'),'release');
 const failed=await L.state(api,source.id,['failed']);
 assert.equal(failed.recovery.scriptConsent.failureSeq,event.seq);
 const declined=await api.call('POST',`/runs/${source.id}/replay`,{nodeId:'effect',observedSeq:failed.recovery.observedSeq});
 assert.equal(declined.status,409);assert.equal(declined.body.code,'SCRIPT_CONSENT_REQUIRED');assert.equal(count(),1);
 const consented=await api.call('POST',`/runs/${source.id}/replay`,{nodeId:'effect',observedSeq:failed.recovery.observedSeq,retryUncertainScript:true});
 assert.equal(consented.status,202,JSON.stringify(consented));assert.notEqual(consented.body.run.id,source.id);
 await L.state(api,consented.body.run.id,['succeeded']);assert.equal(count(),2);
 evidence.after={refusedDuringProjection:replay,declined,consented,source:failed,effects:count(),events:await L.events(api,source.id)};
 L.check('projection gap refuses Replay; stable failure requires explicit consent; consent forks a distinct run',true);
}catch(error){evidence.error=L.redact(error.stack);L.check('native projection reproduction completed',false,evidence.error);}
finally{
 if(api)fs.writeFileSync(path.join(api.dir,'release-failure'),'release');
 db?.close();await L.cleanup();L.save('failure-projection-native-results.json',{checks:L.checks,evidence});
}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
