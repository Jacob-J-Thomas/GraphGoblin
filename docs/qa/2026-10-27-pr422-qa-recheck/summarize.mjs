import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const load=name=>JSON.parse(fs.readFileSync(path.join(L.RECORD,name),'utf8'));
const names=['behaviour-results.json','lineage-results.json','race-results.json','final-results.json','force-http-results.json','upgrade-results.json','fresh-results.json','snapshot-cost-results.json','script-replay-results.json','child-races-results.json'];
const results=names.map(name=>{const r=load(name);return{name,checks:r.checks.length,failed:r.checks.filter(c=>!c.passed).map(c=>c.name),error:r.evidence?.error};});
const earlier=load('interleavings-child-races-results.json');
const corrected=earlier.checks.filter(c=>/changed child reason is explicit/.test(c.name)).map(c=>({
  name:c.name,originalPassed:c.passed,
  explanation:'The probe expected an internal exception message in the logger. The shipped logger records RECOVERY_STALE and parent child recovery refused; observing current child outcome. The retained HTTP refusal also explains that the run changed and requires refresh/review.',
  passed:c.detail.includes('RECOVERY_STALE')&&c.detail.includes('parent child recovery refused; observing current child outcome'),
}));
L.save('assertion-review.json',{corrected,interleavings:['pending','early','different'].map(name=>{
  const s=earlier.evidence.scenarios[name];
  return {name,parentId:s.parentId,childId:s.childId,effectsBeforeFresh:s.effectsBeforeFresh.length,effectsAfterFresh:s.finalEffects.length,
    oldConsent:s.old,newConsentRequired:s.noConsent,binding:s.binding,childFailureBeforeFresh:s.changedChild.failure};
}),restartFixtureCorrection:'The initial reopen incorrectly started base.manager before the decorated manager. Only the single-manager reopen in child-races-results.json qualifies restart.'});
const upgrade=load('upgrade-results.json').evidence;
L.save('results-summary.json',{results,assertionCorrections:corrected,
  migrations:{before:upgrade.oldLedger.length,after:upgrade.newLedger.length,reopen:upgrade.secondLedger.length},
  acceptance:load('batch-acceptance.json'),edge:load('behaviour-results.json').evidence.environment.edge,
  throughput:load('throughput.json').phases,
});
console.log(JSON.stringify(results));
console.log(JSON.stringify({migrationRows:[upgrade.oldLedger.length,upgrade.newLedger.length,upgrade.secondLedger.length],corrected}));
