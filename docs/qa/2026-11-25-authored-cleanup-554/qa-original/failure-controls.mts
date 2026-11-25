import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = 'G:/ggq/gg-fu-authored-cleanup-20261124/GraphGoblin';
const source = (path: string) => import(pathToFileURL(join(root, path)).href);
const {planMutation, MutationError, PatchError, ExpressionError, TemplateError} = await source('packages/domain/src/index.ts');
const {MutationOperationSchema} = await source('packages/contracts/src/index.ts');
const {sampleThread} = await source('packages/contracts/src/testing/index.ts');

const ctx = {nodeId:'qa', newId:()=> 'qa-message', now:()=> '2026-11-25T05:11:00.000Z'};
const jsonSchema = {type:'object', properties:{ok:{type:'boolean'}}, required:['ok']};
const coerce = MutationOperationSchema.parse({op:'coerce',source:'/vars/value',jsonSchema,target:'/vars/result'});
const cases = [];

async function captureRejection(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return error;
  }
  assert.fail('Expected the public mutation planner to reject');
}
for (const error of [
  new Error('external'), new MutationError('external'), new PatchError('external'),
  new TemplateError('external'), new ExpressionError('external'), null, 11,
]) {
  const thread = sampleThread();
  thread.vars.value = Object.defineProperty({}, 'ok', {enumerable: true, get() { throw error; }});
  const factCalls: unknown[][] = [], ordinaryCalls: unknown[][] = [];
  const fact = (...args: unknown[]) => {factCalls.push(args); return new Error('wrong authored attribution');};
  const ordinaryResult = new Error('ordinary mapped failure');
  const ordinary = (...args: unknown[]) => {ordinaryCalls.push(args); return ordinaryResult;};
  assert.equal(await captureRejection(() => planMutation(thread, coerce, ctx, 8, undefined, fact)), error);
  assert.equal(await captureRejection(() => planMutation(thread, coerce, ctx, 8, ordinary, fact)), ordinaryResult);
  assert.deepEqual(ordinaryCalls, [[error, 8, 'coerce']]);
  assert.deepEqual(factCalls, []);
  cases.push({scenario: error instanceof Error ? error.constructor.name : String(error), exactIdentity: true, ordinaryMapper: true, authoredAttribution: false});
}

const thread = sampleThread();
thread.vars.value = {ok: true};
assert.deepEqual(await planMutation(thread, coerce, ctx, 0), {
  kind: 'patch', patch: [{op: 'add', path: '/vars/result', value: {ok: true}}],
});
cases.push({scenario:'valid JSON', exactPatch:true});
thread.vars.value = {ok: 'wrong'};
const repair = await planMutation(thread, coerce, ctx, 0);
assert.equal(repair.kind, 'repair');
assert.deepEqual(repair.request.value, {ok: 'wrong'});
cases.push({scenario:'supported invalid JSON value', repair:true});
const target = MutationOperationSchema.parse({...coerce,target:'/run/id'});
const authoredCalls: unknown[][] = [];
const marker = new Error('genuine authored marker');
const authored = (...args: unknown[]) => {authoredCalls.push(args); return marker;};
assert.equal(await captureRejection(() => planMutation(thread, target, ctx, 2, undefined, authored)), marker);
assert.deepEqual(authoredCalls, [[{kind:'target'},2,'coerce']]);
cases.push({scenario:'forbidden authored target', genuineAuthoredFact:true});
console.log(JSON.stringify({
  cases, total: cases.length,
  qualifier: 'Throw controls use a synthetic direct JavaScript getter. They do not establish a supported persisted JSON throw path.',
}, null, 2));

