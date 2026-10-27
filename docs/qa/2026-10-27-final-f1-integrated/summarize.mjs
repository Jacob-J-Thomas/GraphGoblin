import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
for(const name of ['behaviour','restart','race','nested','retention','format','force-nested','force-failure','force-http','sustained']){const p=path.join(L.RECORD,name+'-results.json');const r=JSON.parse(fs.readFileSync(p,'utf8'));console.log(name,JSON.stringify({passed:r.checks.filter(c=>c.passed).length,failed:r.checks.filter(c=>!c.passed).map(c=>c.name),error:r.evidence?.error}));}
const r=JSON.parse(fs.readFileSync(path.join(L.RECORD,'sustained-results.json'),'utf8')).evidence;
const summary={edge:r.edge,openedSeq:r.openedSeq,followedEvents:r.followedEvents,samples:r.samples.map(s=>({label:s.label,from:s.A.from,to:s.A.to,A:s.A.rate,B:s.B.rate,apiMemory:s.apiMemory,heap:s.heapMiB,cache:s.sessionStorageBytes,rows:s.view?.rowsMounted})),final:{seq:r.final.A.lastEventSeq,statusA:r.final.A.status,statusB:r.final.B.status,vars:r.final.vars,heap:r.final.heapMiB,cache:r.final.cacheBytes,requests:r.final.requests},sse:r.sse};L.save('measurement-summary.json',summary);console.log(JSON.stringify(summary));
const format=JSON.parse(fs.readFileSync(path.join(L.RECORD,'format-results.json'),'utf8')).evidence;console.log('RESET PREVIEW',format.reset.dry.stdout);console.log('RESET ACTUAL',format.reset.reset.stdout);
