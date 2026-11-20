import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
const root = process.argv[2] ?? '.', read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push({ name, pass: true }); };
const source = await read('records/source-identity.json');
check('exact tested immutable source/tree', source.source === '6acf37fe02aed35a0f1bb6e3d24cc869d621bbb8' && source.tree === 'f7da19cd267622e6ded1bf3356a2ffbd31784e96');
check('exact production hash', source.files['apps/web/src/editor/decision-route-edges.ts'] === 'd2ed6a3c8dcdcdd5bef3db871182d2016c03f7523e39e66c7f9142e2630ef886');
const inputBytes = await fs.readFile(path.join(root, 'replay-inputs/prior-live-collision.json')), input = JSON.parse(inputBytes);
check('exact captured earlier device input bytes', createHash('sha256').update(inputBytes).digest('hex') === '40fd7ee7b96e0f5f78f50442ece0f1230d489c93d8be1747019c87531dd63974');
const table = x => x?.device?.decisionRoutes?.pick;
const present = x => Boolean(x?.deviceOwnDecisionRoutes && Object.hasOwn(x.device, 'decisionRoutes') && table(x) && Number.isInteger(table(x).nextKey) && table(x).rows.length > 0 && table(x).rows.every(r => Number.isInteger(r.key) && Array.isArray(r.edgeIds) && r.edgeIds.every(id => typeof id === 'string')));
const sameState = (a, b) => present(a) && present(b) && same(a.device.definition, b.device.definition) && same(a.device.decisionRoutes, b.device.decisionRoutes);
const loops = await read('records/loops.json');
for (const key of ['shared-rename', 'shared-remove', 'shared-direct', 'unique-rename', 'unique-remove', 'unique-direct']) {
  const raw = await read('records/' + key + '-browser.json'), get = p => raw.observations.find(x => x.phase === p), before = get('original').server.definition, after = get('changed'), removal = loops[key].action === 'remove-after-collision';
  const expected = removal ? before.edges.filter((_, i) => i !== 2) : before.edges.map((edge, i) => i === 2 ? { ...edge, from: { ...edge.from, port: 'affirm' } } : edge);
  check(key + ': exact intended physical record and manual geometry', same(after.device.definition.edges, expected));
  check(key + ': native Undo/Redo retain definition and positively present map', same(get('undo-' + (removal ? 2 : 1)).device.definition, before) && sameState(get('redo-' + (removal ? 2 : 1)), after));
  if (removal) check(key + ': review names intended second record and Cancel preserves full state', same(raw.review.entries, ['Connection no → other (' + before.edges[2].id + ')']) && sameState(get('cancelled'), get('collision')));
  if (key === 'shared-rename' || key === 'shared-remove') {
    const continuation = await read('records/' + key + '-continuation.json');
    check(key + ': first unchanged 30000ms save timeout preserved, recovery does not repeat edits', raw.status === 'automation-error' && raw.error.includes('Timeout 30000ms') && continuation.status === 'complete' && continuation.guardServerAndDeviceDefinitionEqual === true && continuation.continuedWithoutRepeatingRouteEdits === true);
    check(key + ': actual offline device reload and explicit recovery public reload exact', sameState(get('offline-reloaded'), after) && same(continuation.observations.at(-1).server.definition, after.device.definition));
  } else check(key + ': ordinary first attempt completes and public reload exact', raw.status === 'complete' && same(get('server-reloaded').server.definition, after.device.definition));
}
const stores = await read('records/store-journey.json');
check('six independent fresh store cases pass all recorded criteria', stores.length === 6 && stores.every(x => Object.values(x.criteria).every(Boolean)));
const ambiguityStore = await read('records/ambiguity-store.json');
check('four ambiguity store cases: safe initial operation and exact later record/history', ambiguityStore.cases.length === 4 && ambiguityStore.cases.every(x => x.preview.length === 0 && same(x.after.definition.edges, x.inputDefinition.edges) && same(x.later.definition.edges, x.expectedLaterEdges) && x.historyExact));
for (const action of ['repair', 'remove']) {
  const raw = await read('records/prior-map-' + action + '-browser.json'), get = p => raw.observations.find(x => x.phase === p), before = get('actual-candidate-restored-map'), after = get('changed'), later = get('later-explicit-first-row-edit');
  const expectedAfter = structuredClone(before.device.definition), config = expectedAfter.nodes.find(n => n.id === 'pick').config;
  if (action === 'repair') config.routes[1].id = 'affirm'; else config.routes.splice(1, 1);
  const expectedLater = structuredClone(expectedAfter); expectedLater.nodes.find(n => n.id === 'pick').config.routes[0].id = 'accepted'; expectedLater.edges[1].from.port = 'accepted';
  const sanitized = structuredClone(input.decisionRoutes); sanitized.pick.rows[0].edgeIds = []; sanitized.pick.rows[1].edgeIds = [];
  check(action + ': genuine captured persisted old map positively present and exact', present(before) && same(before.device.decisionRoutes, input.decisionRoutes));
  check(action + ': initial operation preserves every physical record and all other content', same(after.device.definition, expectedAfter));
  check(action + ': subsequent explicit rename changes only actual first yes→done record', same(later.device.definition, expectedLater));
  check(action + ': initial Undo restores full definition and sanitized load ownership map', present(get('undo-initial-change')) && same(get('undo-initial-change').device.definition, before.device.definition) && same(get('undo-initial-change').device.decisionRoutes, sanitized));
  check(action + ': native remaining Undo/Redo map and definition exact', sameState(get('undo-later-edit'), after) && sameState(get('redo-initial-change'), after) && sameState(get('redo-later-edit'), later));
  check(action + ': offline device recovery and online public save/reload exact', raw.status === 'complete' && sameState(get('offline-device-reloaded'), later) && ['saved', 'server-reloaded'].every(p => get(p).server.status === 200 && same(get(p).server.definition, expectedLater)));
  if (action === 'remove') check('ambiguous removal has no connection-removal review', raw.review.shown === false && same(raw.review.entries, []));
}
const validation = (await read('records/public-api-fixtures.json')).filter(x => x.route.endsWith('/validate'));
check('six correct-body validation controls retain exact input and HTTP200', validation.length === 6 && validation.every(x => x.input.definition && x.status === 200));
check('shared duplicates remain invalid; unique controls publishable', validation.slice(0, 3).every(x => x.output.publishable === false && x.output.issues.some(i => i.code === 'DUPLICATE_EDGE_ID')) && validation.slice(3).every(x => x.output.publishable === true && x.output.issues.length === 0));
const http = await read('records/ambiguity-http.json');
check('server refuses duplicate-route fixture without a bypass', http[0].status === 400 && (http[0].output.error ?? http[0].output.code) === 'VALIDATION_FAILED');
const freshSummary = await read('records/summary.json'), deviceSummary = await read('records/device-summary.json');
check('positive metadata shape samples count54', freshSummary.positivelyPresentDeviceMetadataSamples === 36 && deviceSummary.positivelyPresentDeviceMetadataSamples === 18 && freshSummary.allPresentMetadataShapesValid && deviceSummary.cases.every(x => x.metadataSamples.every(s => s.nonemptyShapeValid)));
const cleanup = await read('records/credential-cleanup.json');
check('credential revoked and denied, exact token scan empty', cleanup.revokeStatus === 204 && cleanup.oldCredentialDeniedStatus === 401 && cleanup.retainedTokenHits.length === 0);
console.log(JSON.stringify({ result: 'pass', checksPassed: checks.length, checksTotal: checks.length, source: source.source, counts: { store: '10/10', browser: '8/8 ownership criteria', freshBrowserFirstAttemptsComplete: '4/6', explicitRecoveryContinuations: '2/2', positiveDeviceMapSamples: 54 }, checks, qualification: 'Read-only replay of retained observations; no new behavior execution, no inference about automatic reconnect, OS cold startup, owner data, providers or formal gates.' }, null, 2));
