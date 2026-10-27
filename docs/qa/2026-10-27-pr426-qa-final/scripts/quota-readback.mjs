// Read back the already-resumed quota run after graceful drain. Never submit another turn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('quota-readback');let g;
try {
  const prior=JSON.parse(fs.readFileSync(path.join(L.OUT,'native-durable-snapshots.json'),'utf8'));
  const dir=prior.store.replace('%USERPROFILE%',os.homedir());
  if(path.dirname(dir)!==os.tmpdir()||!path.basename(dir).startsWith('gg-qa-426f-native-durable-')) throw Error('Not this QA store');
  const fake=L.fakeCli(dir);const before=fake.requests().length;
  const target=prior.cases.find(c=>c.name==='quota-new-rate-same-message');
  g=await L.startGateway({dir,port:6737,label:'quota-readback',env:fake.env,rec});
  const run=(await g.call('/runs/'+target.id)).json;const events=await L.events(g.call,target.id);
  rec.log('already resumed quota final record',{run,events,requests:fake.requests()});
  rec.check('prior quota Resume returned HTTP 200, accepted exactly one resumed fake request',JSON.parse(fs.readFileSync(path.join(L.OUT,'native-durable-result.json'),'utf8')).checks.find(c=>c.id==='quota Resume is accepted and succeeds through fake CLI after restart').detail.resume===200&&before===18&&fake.requests().at(-1)?.resume===true,{before,lastRequest:fake.requests().at(-1)});
  rec.check('already resumed quota run settled successfully',run.status==='succeeded',{status:run.status,failure:run.failure??null});
  rec.check('readback submitted zero additional turns',fake.requests().length===before,{before,after:fake.requests().length});
}catch(error){rec.check('quota readback completed without exception',false,String(error.stack??error));}
finally{if(g){rec.check('readback gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('quota-readback-gateway.log.txt');}rec.finish();}
