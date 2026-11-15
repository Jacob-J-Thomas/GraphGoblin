// Direct public ports with controlled collaborators. No gateway, network, provider, or database here.
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCandidateBinding, sha } from './binding.mjs';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const [admissionPath,attempt] = process.argv.slice(2);
assert.match(attempt ?? '', /^ports-attempt-[1-9][0-9]*$/);
const spec = JSON.parse(await readFile(admissionPath,'utf8'));
assert.equal(spec.status,'CORRECTED_NATIVE_ADMITTED');
assert.equal(spec.portsAttempt,attempt);
const binding = await readCandidateBinding(spec);
const loadBuilt = (file) => import(pathToFileURL(join(binding.checkout,file)).href);
const {admitPollItems} = await loadBuilt('apps/api/dist/triggers/poll-items.js');
const {PollTriggers} = await loadBuilt('apps/api/dist/triggers/poll.js');
const {LoopDefinitionSchema,PollItemsSchema,CURRENT_DEFINITION_FORMAT} = await loadBuilt('packages/contracts/dist/index.js');
const fixtureBytes = await readFile(join(root,'..','wire-fixtures.json'));
const wire = JSON.parse(fixtureBytes);
const value = (tag) => wire.sources[tag].value;

const out = join(root,attempt);
await mkdir(out);
assert.equal(await realpath(out),out);
const report = {scope:'public methods with controlled collaborators', candidate:spec.head,
  fixtureSha256:sha(fixtureBytes), cases:[]};
const now = '2026-11-15T12:00:00.000Z';
function itemCase(label, candidates, {cap=10, seen=[], failOn, lookupFails=false} = {}) {
  const evidence = {label, tier:'items ports', lookups:[], starts:[]};
  report.cases.push(evidence);
  const config = PollItemsSchema.parse({select:'probe.items',dedupeKey:'item.key',maxRunsPerPoll:cap});
  const result = admitPollItems(config, {now,probe:{items:candidates}}, {
    findSeen: async (keys) => {
      evidence.lookups.push([...keys]);
      if (lookupFails) throw new Error('private evaluator canary');
      return new Set(seen);
    },
    start: async ({dedupeKey}) => {
      evidence.starts.push(dedupeKey);
      if (dedupeKey === failOn) throw new Error('private admission canary');
      return {id:dedupeKey};
    },
  });
  return {evidence,result};
}
const mapped = (keys) => keys.map((key) => ({key}));
const itemDiag = (itemIndex) => ({itemIndex, code:binding.diagnostics.item.code, reason:binding.diagnostics.item.reason});
async function checksItems() {
  const p2 = JSON.parse(wire.phases.corrected.items[1].body).items;
  const mixed = itemCase('P2 lookup argument and admission trace',p2,{seen:[value('A')]});
  const verified = await mixed.result;
  assert.deepEqual(mixed.evidence.lookups,[[value('A'),value('RH'),value('C')]]);
  assert.deepEqual(mixed.evidence.starts,[value('RH'),value('C')]);
  assert.deepEqual(verified.rejections,[0,1,2].map(itemDiag));
  mixed.evidence.rejections = verified.rejections;
  const only = itemCase('malformed-only incurs no lookup',mapped(['H','L','H'].map(value)));
  const refused = await only.result;
  assert.deepEqual(only.evidence.lookups,[]);
  assert.deepEqual(only.evidence.starts,[]);
  assert.deepEqual(refused.rejections,[0,1,2].map(itemDiag));
  only.evidence.rejections = refused.rejections;

  for (const [label,key,reason] of [
    ['wrong type',42,'KEY_INVALID'],['blank',' ','KEY_INVALID'],
    ['overlong','x'.repeat(513),'KEY_INVALID'],['valid duplicate',value('A'),'KEY_DUPLICATE'],
  ]) {
    const invalid = itemCase(label,mapped([value('A'),value('H'),key,value('B')]));
    await assert.rejects(invalid.result,(error) => {
      invalid.evidence.reason = error.reason;
      return error.reason === reason && error.itemIndex === 2;
    });
    assert.deepEqual(invalid.evidence.lookups,[]);
    assert.deepEqual(invalid.evidence.starts,[]);
  }

  const limited = itemCase('depth and seen state preserve the exact cap',
    [...mapped([value('H'),'seen']),{key:'deep',value:Array.from({length:1100}).reduce((previous) => [previous],1)},
      ...mapped([value('P'),value('R'),'after-cap'])],{seen:['seen'],cap:2});
  const capped = await limited.result;
  assert.deepEqual(limited.evidence.lookups,[['seen','deep',value('P'),value('R'),'after-cap']]);
  assert.deepEqual(limited.evidence.starts,[value('P'),value('R')]);
  assert(capped.rejections.some((row) => row.itemIndex === 2 && row.reason === 'NESTING_DEPTH_EXCEEDED'));
  limited.evidence.rejections = capped.rejections;

  const failedLookup = itemCase('lookup failure stops all attempts',mapped([value('A'),value('B')]),{lookupFails:true});
  await assert.rejects(failedLookup.result,/^Error: POLL_DEDUPE_LOOKUP_FAILED$/u);
  assert.deepEqual(failedLookup.evidence.starts,[]);
  const failedStart = itemCase('admission failure stops the remaining tail',mapped([value('A'),value('B'),value('C')]),{failOn:value('B')});
  const partial = await failedStart.result;
  assert.deepEqual(failedStart.evidence.starts,[value('A'),value('B')]);
  assert.equal(partial.failedItemIndex,1);
  assert.deepEqual(partial.runs.map(({id}) => id),[value('A')]);
  failedStart.evidence.failedItemIndex = partial.failedItemIndex;
}

async function singleCase(label,body,desired = {}) {
  const {dedupeKey='probe.json.key', configured=true, seen=false, malformed=false, expected} = desired;
  const evidence = {label,tier:'single poll public ports',lookup:[],starts:[],warnings:[]};
  report.cases.push(evidence);
  let time = Date.parse(now);
  const definition = LoopDefinitionSchema.parse({schemaVersion:CURRENT_DEFINITION_FORMAT,
    name:'QA 361 direct single',nodes:[{id:'poll',kind:'trigger',label:'Poll',config:{
      type:'poll',intervalSeconds:5,fireWhen:'true',probe:{kind:'http',url:'http://127.0.0.1:1/'},
      ...(configured ? {dedupeKey} : {}),
    }}],edges:[]});
  const polls = new PollTriggers({
    clock:{now:() => new Date(time)},
    probes:{fetch:async () => ({status:200,headers:{},body:JSON.stringify(body)})},
    scripts:{run:async () => {throw new Error('Unexpected script execution');}},
    manager:{
      assertAdmissionOpen:() => undefined,
      startRun:async (input) => {
        const hasKey = Object.hasOwn(input,'dedupeKey');
        evidence.starts.push(hasKey ? {hasKey,key:input.dedupeKey} : {hasKey});
        return {id:label};
      },
      startPollItem:async () => {throw new Error('Unexpected item admission');},
    },
    hasDedupe:async (...args) => {evidence.lookup.push(args); return seen;},
    findSeen:async () => {throw new Error('Unexpected item lookup');},
    logger:{warn:(context,message) => evidence.warnings.push({context,message})},
    scriptCwd:out,
  });
  polls.arm({id:'loop',ownerId:'local',name:'QA 361 direct single',createdAt:now,updatedAt:now},
    {id:'version',loopId:'loop',version:1,status:'published',definition,createdAt:now});
  time += 5000;
  const runs = await polls.poll();
  if (malformed) {
    assert.deepEqual(evidence.lookup,[]);
    assert.deepEqual(evidence.starts,[]);
    assert.deepEqual(runs,[]);
    assert.deepEqual(evidence.warnings,[{context:{loopId:'loop',nodeId:'poll',
      code:binding.diagnostics.single.code,reason:binding.diagnostics.single.reason},
      message:binding.diagnostics.single.message}]);
  } else {
    assert.deepEqual(evidence.warnings,[]);
    assert.deepEqual(evidence.lookup,expected === undefined ? [] : [['loop','poll',expected]]);
    assert.deepEqual(evidence.starts,seen ? [] : [expected === undefined ?
      {hasKey:false} : {hasKey:true,key:expected}]);
    assert.deepEqual(runs.map(({id}) => id),seen ? [] : [label]);
  }
}

try {
  await checksItems();
  for (const tag of ['SH','SL','SPLIT']) await singleCase(tag,{key:value(tag),outside:'omit-this-canary'},{malformed:true});
  for (const tag of ['PREFIX','SR','SP']) await singleCase(tag,{key:value(tag),outside:'unrelated\uD800'},{expected:value(tag)});
  await singleCase('seen pair',{key:value('SP')},{expected:value('SP'),seen:true});
  await singleCase('intentional absence',{key:value('SH')},{configured:false});
  await singleCase('configured undefined',{other:'absent'});
  await singleCase('configured null',{key:null});
  await singleCase('configured empty',{key:''});
  assert.deepEqual(await readCandidateBinding(spec),binding);
  report.failure = null;
} catch (error) {
  report.failure = {name:error.name,message:error.message,stack:error.stack};
}
await writeFile(join(out,'result.json'),JSON.stringify(report,null,2) + '\n',{flag:'wx'});
if (report.failure) {
  process.stderr.write(report.failure.message + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Independent instrumented port checks passed: ' + report.cases.length + '\n');
}
