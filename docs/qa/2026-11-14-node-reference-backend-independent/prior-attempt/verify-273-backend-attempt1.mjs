import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = await realpath(process.argv[2]);
const expected = '207b3e53067ebded36c8ec4e28dc47de46e1631f';
const parent = 'a770ca57e642998f71b1d113031e69c7080fc324';
const output = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(source, output).startsWith('..'));
const scratch = await mkdtemp(join(output, 'reference backend '));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const relevant = ['apps/api/src', 'apps/api/templates', 'packages', 'patches', 'pnpm-lock.yaml'];
const fingerprint = async (path) => createHash('sha256').update(await readFile(join(source, path))).digest('hex');
const tracked = [
  'apps/api/src/index.ts', 'apps/api/src/routes/loops.ts', 'apps/api/src/testing/test-app.ts',
  'apps/api/templates/starter/draft.json', 'packages/domain/package.json',
  'packages/domain/src/index.ts', 'packages/domain/src/graph.ts',
  'packages/domain/src/node-references.ts', 'packages/domain/src/expression-references.ts',
  'packages/domain/src/template-references.ts', 'packages/domain/src/node-reference-path.ts',
  'packages/domain/src/syntax.ts', 'packages/domain/src/source-analysis.ts', 'packages/contracts/src/loop.ts', 'pnpm-lock.yaml',
];
const unchanged = () => {
  assert.equal(git('rev-parse', 'HEAD'), expected);
  assert.equal(git('rev-parse', 'HEAD^'), parent);
  assert.equal(git('status', '--porcelain=v1', '--', ...relevant), '');
};
const from = (path) => import(pathToFileURL(join(source, path)).href);
const outcomes = [];
const wire = [];
const hashes = {};
const fixture = { appListened: false };
let api;
let active;
let failure;
try {
  unchanged();
  assert(process.execArgv.includes('--conditions=development'));
  for (const path of tracked) hashes[path] = await fingerprint(path);
  const { renameLoopNode, validateLoop, syntaxIssues, evaluateExpression, renderTemplate } =
    await from('packages/domain/src/index.ts');
  const { LoopDefinitionSchema, LoopExportSchema } = await from('packages/contracts/src/index.ts');
  const { minimalLoop } = await from('packages/contracts/src/testing/index.ts');
  const { createTestApp } = await from('apps/api/src/testing/test-app.ts');
  const issueView = (issues) => issues.filter(({ code }) => code.startsWith('NODE_REFERENCE_'));
  const diagnostics = (definition) => issueView(validateLoop(LoopDefinitionSchema.parse(definition)));
  const exitNode = (definition) => definition.nodes.find(({ kind }) => kind === 'exit');
  const rename = (definition, oldId, newId) => {
    const before = structuredClone(definition);
    const result = renameLoopNode(definition, oldId, newId);
    assert.deepEqual(definition, before);
    assert.equal(result.kind, 'renamed');
    return result;
  };
  const withReturn = (name, returns) => {
    const loop = { ...minimalLoop(), name };
    exitNode(loop).config.returns = returns;
    return loop;
  };

  active = 'structural, typed, JSONata and Liquid';
  const complex = withReturn('Reference boundary fixture', '{"keep-me": "outputs.start", "proof": outputs.start.value.payload, "visits": counters.nodeVisits.start}');
  const literal = { key: 'start', path: '/outputs/start/value', example: 'outputs.start' };
  complex.nodes.push({ id: 'record', kind: 'mutate', label: 'Keep start in label', config: { operations: [
    { op: 'set', path: '/outputs/start/value/a~0b~1c/start', value: { kind: 'literal', value: literal } },
    { op: 'coerce', source: '/counters/nodeVisits/start', target: '/vars/start', jsonSchema: { type: 'integer' } },
    { op: 'set', path: '/vars/literal', value: { kind: 'template', template: 'start: {% raw %}{{ outputs.start }}{% endraw %} → {{ outputs.start.value.payload | upcase }}' } },
  ] } });
  const lastEdge = complex.edges[0];
  const target = lastEdge.to;
  lastEdge.to = { node: 'record' };
  complex.edges.push({ id: 'second', from: { node: 'record', port: 'out' }, to: target });
  const current = rename(complex, 'start', 'new-producer');
  const repaired = current.definition.nodes.find(({ id }) => id === 'record');
  assert.deepEqual(repaired.config.operations[0].value.value, literal);
  assert.equal(repaired.config.operations[0].path, '/outputs/new-producer/value/a~0b~1c/start');
  assert.equal(repaired.config.operations[1].source, '/counters/nodeVisits/new-producer');
  assert.equal(repaired.config.operations[1].target, '/vars/start');
  assert.equal(repaired.label, 'Keep start in label');
  assert.equal(current.definition.edges[0].from.node, 'new-producer');
  assert.equal(current.definition.edges[0].id, lastEdge.id);
  assert.deepEqual(current.definition.edges[1], complex.edges[1]);
  assert.deepEqual(current.warnings, []);
  assert.deepEqual(diagnostics(current.definition), []);
  const thread = { outputs: { 'new-producer': { value: { payload: 'carry' } } }, counters: { nodeVisits: { 'new-producer': 3 } } };
  const evaluated = await evaluateExpression(exitNode(current.definition).config.returns, thread);
  assert.deepEqual({ ...evaluated }, { 'keep-me': 'outputs.start', proof: 'carry', visits: 3 });
  const rendered = await renderTemplate(repaired.config.operations[2].value.template, thread);
  assert.equal(rendered, 'start: {{ outputs.start }} → CARRY');
  outcomes.push({ case: active, repairs: current.repairedReferences, evaluated, rendered });

  active = 'dynamic, custom and opaque source';
  const ambig = withReturn('Opaque paths fixture', '[$lookup(outputs, vars.pick).value, outputs.start.value, counters.nodeVisits.start, "start"]');
  ambig.nodes.push({
    id: 'foreign', kind: 'mutate', label: 'Authored whole-slot key',
    config: { operations: [{ op: 'set', path: '/outputs/start', value: { kind: 'literal', value: { value: 'owner' } } }] },
  }, {
    id: 'opaque', kind: 'script', label: 'Script',
    config: { command: 'unused-opaque-fixture', args: ['example outputs.start only'], stdin: 'thread' },
  });
  const dubious = rename(ambig, 'start', 'move-local');
  const expr = exitNode(dubious.definition).config.returns;
  assert.match(expr, /\$lookup\(outputs, vars\.pick\)/);
  assert.match(expr, /outputs\.start\.value/);
  assert.match(expr, /"move-local"/);
  assert.match(expr, /"start"/);
  assert.deepEqual(dubious.definition.nodes.find(({ id }) => id === 'opaque'), ambig.nodes.at(-1));
  assert.deepEqual(dubious.definition.nodes.find(({ id }) => id === 'foreign'), ambig.nodes.at(-2));
  assert(dubious.warnings.some(({ code, nodeId }) => code === 'NODE_REFERENCE_UNCERTAIN' && nodeId === 'done'));
  assert(dubious.warnings.some(({ code, message }) => code === 'NODE_REFERENCE_UNCERTAIN' && message.includes('scripts and generated patches')));
  outcomes.push({ case: active, expression: expr, warnings: dubious.warnings });

  active = 'refused rename leaves original definition intact';
  const clean = withReturn('Rename refusals', 'outputs.start.value');
  const malformed = structuredClone(clean); malformed.nodes.push(structuredClone(clean.nodes[0]));
  const variants = [[clean, 'start','start','unchanged'], [clean,'missing','valid','missing-node'],
    [clean,'start','bad/id','invalid-id'], [clean,'start','done','duplicate-id'],
    [malformed,'start','valid','ambiguous-node']];
  for (const [graph, oldId, newId, kind] of variants) {
    const bytes = JSON.stringify(graph);
    assert.equal(renameLoopNode(graph, oldId, newId).kind, kind);
    assert.equal(JSON.stringify(graph), bytes);
  }
  outcomes.push({ case: active, variants: variants.map((row) => row[3]) });

  active = 'definite missing reads and explicit presence warnings';
  const optional = withReturn('Presence checks', '$exists(counters.nodeVisits.ghost) ? 0 : 1');
  optional.settings = { workingDirectory: { kind: 'template', template: '{% unless gates.ghost %}/missing{% endunless %}' } };
  const absentIssues = diagnostics(optional);
  assert.deepEqual(absentIssues.map(({ code, severity }) => [code, severity]), Array(2).fill(['NODE_REFERENCE_OPTIONAL_MISSING', 'warning']));
  const definite = withReturn('Real missing reads', '$exists(counters.nodeVisits.ghost + 1) or gates.required.passes > 0');
  const hardIssues = diagnostics(definite);
  assert.deepEqual(hardIssues.map(({ code, severity }) => [code, severity]), Array(2).fill(['NODE_REFERENCE_MISSING', 'error']));
  const inherited = withReturn('Inherited output warning', 'outputs.outerNode.value');
  const inheritedIssues = diagnostics(inherited);
  assert.deepEqual(inheritedIssues.map(({ code, severity }) => [code, severity]), [['NODE_REFERENCE_OUTPUT_UNVERIFIED', 'warning']]);
  outcomes.push({ case: active, absentIssues, hardIssues, inheritedIssues });

  active = 'same source across gate, visit, and producer membership';
  const shared = '[$exists(gates.slot.passes), counters.nodeVisits.slot, outputs.slot.value]';
  const matrix = (name, variant, exitId) => {
    const loop = withReturn(name,shared);
    exitNode(loop).id = exitId;
    loop.edges[0].to.node=exitId;
    if (variant==='gate') {
      loop.nodes.splice(1,0,{
        id:'slot',label:'Gate',kind:'decision',config:{kind:'expression',jsonata:'"out"',routes:[{id:'out',label:'Out'}],maxPasses:2},
      });
      loop.edges[0].to.node='slot';
      loop.edges.push({id:'to-exit',from:{node:'slot',port:'out'},to:{node:exitId}},
        {id:'exhausted-exit',from:{node:'slot',port:'limitReached'},to:{node:exitId}});
    } else if (variant==='authored') {
      loop.nodes.splice(1,0,{
        id:'writer',label:'Set foreign output',kind:'mutate',config:{operations:[
          {op:'set',path:'/outputs/slot',value:{kind:'literal',value:{example:'slot'}}},
        ]},
      });
      loop.edges[0].to.node='writer';
      loop.edges.push({id:'to-exit',from:{node:'writer',port:'out'},to:{node:exitId}});
    } else if (variant==='trigger') {
      loop.nodes[0].id='slot';
      loop.edges[0].from.node='slot';
    }
    return loop;
  };
  const g=matrix('Gate producer','gate','gateDone');
  const m=matrix('Foreign membership','missing','foreignDone');
  const c=matrix('Authored output','authored','customDone');
  const t=matrix('Trigger with same ID','trigger','triggerDone');
  const issueTuple = ({code, severity, nodeId, path}) => [code,severity,nodeId??null,path];
  const optionalCode='NODE_REFERENCE_OPTIONAL_MISSING';
  const missingCode='NODE_REFERENCE_MISSING';
  const unverifiedCode='NODE_REFERENCE_OUTPUT_UNVERIFIED';
  const uncertainCode='NODE_REFERENCE_UNCERTAIN';
  const returnPath='config.returns';
  const missingRows=[
    [optionalCode,'warning','foreignDone',returnPath],
    [missingCode,'error','foreignDone',returnPath],
    [unverifiedCode,'warning','foreignDone',returnPath],
  ];
  // Populate the cache first in a graph missing every identity, then interleave graphs.
  const firstMutable=diagnostics(m);
  assert.deepEqual(firstMutable.map(issueTuple),missingRows);
  firstMutable[0].message='caller-mutated warning';
  firstMutable[0].nodeId='tampered location';
  firstMutable.splice(1);
  assert.deepEqual(diagnostics(g),[]);
  assert.deepEqual(diagnostics(c).map(issueTuple),[
    [optionalCode,'warning','customDone',returnPath], [missingCode,'error','customDone',returnPath],
  ]);
  assert.deepEqual(diagnostics(t).map(issueTuple),[[optionalCode,'warning','triggerDone',returnPath]]);
  assert.deepEqual(diagnostics(m).map(issueTuple),missingRows);
  assert(!diagnostics(m).some(issue=>issue.message.includes('caller-mutated')));
  assert.deepEqual(diagnostics(g),[]);
  outcomes.push({case:active, gated:diagnostics(g), missing:diagnostics(m), authored:diagnostics(c),
    trigger:diagnostics(t), callerModifiedReturnedIssuesIsolated:true});

  active = 'identical source alternated across trigger, thread, parent, and child scopes';
  const mixed='[outputs.start.value, parent.outputs.start.value, child.outputs.start.value, $lookup(outputs, vars.key)]';
  const scopes=withReturn('Source across mixed scopes',mixed);
  scopes.nodes.push({id:'on-event',label:'Event',kind:'trigger',
    config:{type:'event',eventType:'independent-event',dedupeKey:mixed}},
    {id:'child',label:'Child',kind:'subloop',config:{
      loopRef:{loopId:'01ARZ3NDEKTSV4RRFFQ69G5AV'},
      output:{mode:'custom',custom:{patch:mixed},vars:{strategy:'explicit',map:{sample:mixed}}},
    }});
  const renamedScopes=rename(scopes,'start','renamedKey');
  const event=renamedScopes.definition.nodes.find(n=>n.id==='on-event');
  const sub=renamedScopes.definition.nodes.find(n=>n.id==='child');
  assert.equal(event.config.dedupeKey,mixed);
  assert.equal(sub.config.output.vars.map.sample,mixed);
  assert.equal(exitNode(renamedScopes.definition).config.returns,
    '[outputs.renamedKey.value, parent.outputs.start.value, child.outputs.start.value, $lookup(outputs, vars.key)]');
  assert.equal(sub.config.output.custom.patch,
    '[outputs.start.value, parent.outputs.renamedKey.value, child.outputs.start.value, $lookup(outputs, vars.key)]');
  const warmScope=rename(scopes,'start','nextKey');
  assert.equal(warmScope.definition.nodes.find(n=>n.id==='child').config.output.custom.patch,
    '[outputs.start.value, parent.outputs.nextKey.value, child.outputs.start.value, $lookup(outputs, vars.key)]');
  assert(renamedScopes.warnings.some(({code,nodeId,path})=>
    code===uncertainCode&&nodeId==='done'&&path===returnPath));
  assert(!renamedScopes.warnings.some(({nodeId})=>nodeId==='on-event'));
  outcomes.push({case:active, trigger:event.config.dedupeKey, thread:exitNode(renamedScopes.definition).config.returns,
    parent:sub.config.output.custom.patch, child:sub.config.output.vars.map.sample, warnings:renamedScopes.warnings});

  active = 'warm escapes and independent rename targets';
  const tick=String.fromCharCode(96);
  const text='{"opaque":"start", "a": outputs.' + tick + 'start' + tick +
    '.value, "b": $lookup(outputs,"st\\u0061rt").value}';
  const escaped=withReturn('Escaped source reuse',text);
  escaped.settings={ workingDirectory:{kind:'template',
    template:'literal start {{ outputs["st\\u0061rt"].value }} | {% raw %}{{ outputs.start }}{% endraw %}'} };
  const target1=rename(escaped,'start','move-2');
  const firstExit=exitNode(target1.definition).config.returns;
  const firstTemplate=target1.definition.settings.workingDirectory.template;
  target1.definition.settings.workingDirectory.template='caller overwrote returned template';
  exitNode(target1.definition).config.returns='caller overwrote return';
  const target2=rename(escaped,'start','null');
  const secondExit=exitNode(target2.definition).config.returns;
  const secondTemplate=target2.definition.settings.workingDirectory.template;
  assert.match(firstExit,/outputs.`move-2`.value/);
  assert.match(secondExit,/outputs.`null`.value/);
  assert(secondExit.includes('$lookup(outputs,"null")'));
  assert.equal(await renderTemplate(firstTemplate,{outputs:{'move-2':{value:'first'}}}), 'literal start first | {{ outputs.start }}');
  assert.equal(await renderTemplate(secondTemplate,{outputs:{null:{value:'second'}}}), 'literal start second | {{ outputs.start }}');
  assert.deepEqual({...await evaluateExpression(secondExit,{outputs:{null:{value:'second'}}})},
    {opaque:'start',a:'second',b:'second'});
  assert.deepEqual(diagnostics(target2.definition),[]);
  outcomes.push({case:active,firstExit,secondExit,firstTemplate,secondTemplate});

  active = 'syntax diagnostics preserve order and field identity across warm calls';
  const cold=withReturn('Cold syntax aliases','counters.nodeVisits.unknown + $lookup(outputs, vars.opaque)');
  cold.settings={workingDirectory:{kind:'template',template:'{% unsupported_independent_tag %}'}};
  const invalid='parent.gates.missing.passes +';
  cold.nodes[0]={ id:'entry',kind:'trigger',label:'Entry',config:{type:'event',eventType:'qa-syntax',dedupeKey:invalid}};
  cold.edges[0].from.node='entry';
  const alternate=structuredClone(cold);
  alternate.name='Warm syntax aliases';
  alternate.nodes[0].id='warm-entry';
  alternate.nodes[1].id='warm-done';
  alternate.edges[0].from.node='warm-entry';
  alternate.edges[0].to.node='warm-done';
  const normalize=(d)=>LoopDefinitionSchema.parse(d);
  const sourceErrors=(d)=>validateLoop(normalize(d)).filter(({code})=>code.endsWith('_INVALID')||code.startsWith('NODE_REFERENCE_'));
  const expectedOrder=[
    ['TEMPLATE_INVALID','error',null,'settings.workingDirectory.template'],
    ['EXPRESSION_INVALID','error','entry','config.dedupeKey'],
    [missingCode,'error','done',returnPath],
    [uncertainCode,'warning','done',returnPath],
  ];
  const coldOutput=sourceErrors(cold);
  assert.deepEqual(coldOutput.map(issueTuple),expectedOrder);
  assert.deepEqual(syntaxIssues(normalize(cold)).map(issueTuple),expectedOrder.slice(0,2));
  const warmOutput=sourceErrors(alternate);
  assert.deepEqual(warmOutput.map(issueTuple),expectedOrder.map(([code,severity,id,path])=>
    [code,severity,id&&'warm-'+id,path]));
  assert.deepEqual(sourceErrors(cold),coldOutput);
  outcomes.push({case:active,cold:coldOutput,warm:warmOutput});
  active = 'Fastify and file SQLite initialization';
  const data = join(scratch, 'store');
  await mkdir(data);
  api = await createTestApp({ env: { GG_DATA_DIR: data, GG_DB_URL: 'file:' + join(data, 'fixture.db').replaceAll('\\','/'), GG_OLLAMA_ENABLED: 'false' } });
  fixture.fileSqlite = (await stat(join(data, 'fixture.db'))).isFile();
  fixture.appListened = api.app.server.listening;
  assert(fixture.fileSqlite);
  assert.equal(fixture.appListened, false);
  const ask = async (method, path, expectedStatus, payload, headers) => {
    const response = await api.app.inject({ method, url: path, payload, headers });
    const body = response.json();
    wire.push({ method, path, status: response.statusCode, code: body.code ?? null,
      issues: issueView(body.issues ?? body.errors ?? []) });
    assert.equal(response.statusCode, expectedStatus, JSON.stringify(body));
    return body;
  };

  active = 'Fastify refusal preserves published version and draft';
  const original = withReturn('Immutable published reference', 'outputs.start.value.answer');
  const created = await ask('POST', '/loops', 201, { definition: original });
  const loopPath = '/loops/' + created.loop.id;
  const published = await ask('POST', loopPath + '/publish', 200);
  const detail = await ask('GET', loopPath, 200);
  const broken = structuredClone(detail.current.definition);
  exitNode(broken).config.returns = 'counters.nodeVisits.ghost';
  const saved = await ask('PUT', loopPath + '/draft', 200, { definition: broken }, { 'if-match': '"' + detail.draftToken + '"' });
  assert.equal(saved.issues.filter(({ code }) => code === 'NODE_REFERENCE_MISSING').length, 1);
  const checked = await ask('POST', loopPath + '/validate', 200, { definition: broken });
  assert.equal(checked.publishable, false);
  const rejected = await ask('POST', loopPath + '/publish', 422);
  assert.equal(rejected.code, 'LOOP_INVALID');
  const after = await ask('GET', loopPath, 200);
  assert.deepEqual(after.current, published.version);
  assert.deepEqual(after.draft, saved.draft);
  assert.equal(after.draftToken, saved.draftToken);
  const history = await ask('GET', loopPath + '/versions', 200);
  assert.deepEqual(history.items.map(({ id, status }) => [id,status]).sort(), [[published.version.id,'published'],[saved.draft.id,'draft']].sort());
  const originalVersion = await ask('GET', loopPath + '/versions/' + published.version.id, 200);
  assert.deepEqual(originalVersion, published.version);
  outcomes.push({ case: active, loop: created.loop.id, immutableVersion: published.version.id, retainedDraft: saved.draft.id });

  active = 'actual authored output and inherited output execute';
  const child = withReturn('Child inherits provider-free metadata', 'outputs.contextMaker.value.msg');
  const childId = await api.publishLoop(child);
  const parentGraph = withReturn('Parent uses an intentional custom output', '[outputs.call.value.result, outputs.ownerDefined.value]');
  parentGraph.nodes[0].id = 'contextMaker';
  parentGraph.nodes.splice(1,0,
    { id: 'explicit', label: 'Custom output', kind: 'mutate', config: { operations: [
      { op:'set', path:'/outputs/ownerDefined', value:{ kind:'literal',value:{ nodeId:'ownerDefined',value:'authored',at:'2026-01-01T00:00:00.000Z' } } },
    ] } },
    { id: 'call',label:'Child',kind:'subloop',config:{loopRef:{loopId:childId}} },
  );
  parentGraph.edges = [
    { id:'trigger-explicit',from:{node:'contextMaker',port:'out'},to:{node:'explicit'} },
    { id:'explicit-call',from:{node:'explicit',port:'out'},to:{node:'call'} },
    { id:'call-exit',from:{node:'call',port:'out'},to:{node:'done'} },
  ];
  const parentLoop = await api.publishLoop(parentGraph);
  const tested = await ask('POST', '/loops/'+parentLoop+'/runs', 202, { input:{ msg:'inherited' } });
  await api.idle();
  const actual = await ask('GET','/runs/'+tested.run.id,200);
  assert.equal(actual.status,'succeeded',JSON.stringify(actual.failure));
  assert.deepEqual(actual.result,['inherited','authored']);
  outcomes.push({ case:active, result:actual.result, providerUsed:false });

  active = 'shipped Starter rename and provider-controlled run';
  const starter = LoopExportSchema.parse(JSON.parse(await readFile(join(source,'apps/api/templates/starter/draft.json'),'utf8'))).loop;
  const starterResult = rename(starter,'assistant','assistant-local');
  assert.deepEqual(starterResult.warnings, []);
  const definition = { ...starterResult.definition, name:'Starter renamed independent fixture' };
  const resultFromEffectiveExit = await evaluateExpression(exitNode(definition).config.returns,
    { outputs:{ 'assistant-local': { value:'exact synthetic inference output' } } });
  assert.equal(resultFromEffectiveExit,'exact synthetic inference output');
  api.harness.script([{finalText:'exact synthetic inference output'}]);
  const starterId = await api.publishLoop(definition);
  const result = await ask('POST','/loops/'+starterId+'/runs',202,{input:{title:'Fixture'}});
  await api.idle();
  const snapshot = await ask('GET','/runs/'+result.run.id,200);
  assert.equal(snapshot.status,'succeeded',JSON.stringify(snapshot.failure));
  assert.equal(snapshot.result,'exact synthetic inference output');
  outcomes.push({ case:active, effectiveExit:exitNode(definition).config.returns, evaluatedResult:resultFromEffectiveExit,
    executedResult:snapshot.result, inferenceBoundary:'in-process scripted harness', repairedReferences:starterResult.repairedReferences });
  for (const [path, hash] of Object.entries(hashes)) assert.equal(await fingerprint(path), hash);
  unchanged();
} catch (error) {
  failure = { scenario: active ?? 'load public source', message: String(error), stack: error.stack };
  throw error;
} finally {
  await api?.close();
  fixture.appClosed = !api?.app.server.listening;
  fixture.externalNetwork = false;
  fixture.pid = process.pid;
  const report = { expected, parent, headAfter: git('rev-parse','HEAD'), scopeAfter: git('status','--porcelain=v1','--',...relevant),
    runtime: process.version, platform: process.platform, arch: process.arch, sourceCondition: process.execArgv,
    hashes, fixture, outcomes, wire, failure: failure ?? null };
  const reportPath = join(scratch,'observed.json');
  await writeFile(reportPath, JSON.stringify(report,null,2)+'\n');
  console.log(reportPath);
}
