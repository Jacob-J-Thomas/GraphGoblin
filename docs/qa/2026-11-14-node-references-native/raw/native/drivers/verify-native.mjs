// Checks the recorded native evidence (native-observed-1.json: N1-N2, N4-N6; native-observed-2.json:
// N3) against exact expectations and writes native-verified.json. Exit 1 on any failed check.
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
const one = JSON.parse(await readFile(join(dir, 'native-observed-1.json'), 'utf8'));
const two = JSON.parse(await readFile(join(dir, 'native-observed-2.json'), 'utf8'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
const node = (d, id) => d.nodes.find((n) => n.id === id);

// N1-N2
const s = one.scenarios['N1-N2 Starter assistant to writer on file SQLite'];
check('N1-N2 completed', s.ok, s.error);
const before = s.beforeDefinition;
const expected = structuredClone(before);
for (const n of expected.nodes) {
  if (n.id === 'assistant') n.id = 'writer';
  if (n.id === 'review') n.config.prompt.template = 'The assistant step wrote:\n{{ outputs.writer.value }}\nReview it.';
  if (n.id === 'done') n.config.returns = 'outputs.writer.value';
}
for (const e of expected.edges) {
  if (e.from.node === 'assistant') e.from.node = 'writer';
  if (e.to.node === 'assistant') e.to.node = 'writer';
}
const puts = s.network.filter((x) => x.method === 'PUT');
check('three draft PUTs: rename, undo, redo', puts.length === 3, puts.map((p) => p.status));
check('rename PUT If-Match is the loaded token', puts[0]?.ifMatch === `"${s.beforeToken}"`, puts[0]?.ifMatch);
check('rename PUT body is the complete renamed draft', isDeepStrictEqual(puts[0]?.requestBody?.definition, expected));
check('rename PUT answered 200 with a new token', puts[0]?.status === 200 && puts[0]?.responseBody?.draftToken && puts[0].responseBody.draftToken !== s.beforeToken, puts[0]?.responseBody);
const c = s.checks;
check('server draft after rename equals expected', isDeepStrictEqual(c.afterRenameServer.definition, expected));
check('rename PUT response token equals server token', puts[0]?.responseBody?.draftToken === c.afterRenameServer.token);
check('device copy after rename: same definition, synced, server token', isDeepStrictEqual(c.afterRenameDevice.definition, expected) && c.afterRenameDevice.synced === true && c.afterRenameDevice.baseToken === c.afterRenameServer.token, { synced: c.afterRenameDevice.synced, baseToken: c.afterRenameDevice.baseToken });
check('focus stays in Node id after Enter', c.focusAfterEnter?.id === 'node-id', c.focusAfterEnter);
check('dialog notice wording', c.dialogNoticeText.includes('Renamed assistant to writer') && c.dialogNoticeText.includes('Updated 2 references in expressions, templates and mutation paths, and 2 connections.') && c.dialogNoticeText.includes('Plain text, JSON values and scripts are not changed.') && c.dialogNoticeText.includes('Check scripts and generated patches for references to the old ID.') && c.dialogNoticeText.includes('Undo reverses the whole rename.'), c.dialogNoticeText);
check('one labelled undo step', c.undoName.includes('Undo rename assistant to writer'), c.undoName);
check('undo PUT If-Match is the rename save token', puts[1]?.ifMatch === `"${c.afterRenameServer.token}"`, puts[1]?.ifMatch);
check('undo restores every source and edge end', isDeepStrictEqual(c.afterUndoServer.definition, before) && isDeepStrictEqual(puts[1]?.requestBody?.definition, before));
check('undo ends the notice', c.noticeAfterUndo === 0);
check('redo PUT If-Match is the undo save token', puts[2]?.ifMatch === `"${c.afterUndoServer.token}"`, puts[2]?.ifMatch);
check('redo returns the renamed draft', isDeepStrictEqual(c.afterRedoServer.definition, expected) && isDeepStrictEqual(puts[2]?.requestBody?.definition, expected));
check('device copy after redo synced with redo token', isDeepStrictEqual(c.afterRedoDevice.definition, expected) && c.afterRedoDevice.synced === true && c.afterRedoDevice.baseToken === c.afterRedoServer.token);
check('reload: same draft, synced device copy, no notice, no save', isDeepStrictEqual(c.afterReloadServer.definition, expected) && c.afterReloadServer.token === c.afterRedoServer.token && c.afterReloadDevice.synced === true && c.noticeAfterReload === 0);
const publishes = s.network.filter((x) => x.method === 'POST' && x.path.endsWith('/publish'));
check('UI publish answered 200 with version 2', publishes.length === 1 && publishes[0].status === 200 && publishes[0].responseBody?.version?.version === 2, publishes.map((p) => p.status));
check('version 2 equals the saved draft', c.v2EqualsSavedDraft && isDeepStrictEqual(c.v2Definition, expected));
check('version 1 immutable and still reads the assistant', c.v1Immutable === true && c.v1StillReadsAssistant === 'outputs.assistant.value' && isDeepStrictEqual(s.v1.definition, before));
check('versions are 2 published/snapshot rows', c.versions.length === 2, c.versions);
const run = (r, versionId, text) => r.final.status === 'succeeded' && r.final.result === text && r.final.versionId === versionId && r.started.versionId === versionId;
check('pinned v1 run before rename succeeds with its own output', run(s.runV1BeforeRename, s.v1.id, 'Native v1 summary before rename.'), s.runV1BeforeRename.final);
const v2Id = c.versions.find((v) => v.version === 2).id;
check('pinned v2 run reads outputs.writer and succeeds', run(s.runV2, v2Id, 'Native v2 summary from writer.'), s.runV2.final);
check('pinned v1 run after rename still succeeds', run(s.runV1AfterRename, s.v1.id, 'Native v1 summary after rename.'), s.runV1AfterRename.final);
check('prose and JSON literal and script unchanged', node(expected, 'instructions').config.operations[1].value.value.reads === 'outputs.assistant.value' && isDeepStrictEqual(node(c.afterRedoServer.definition, 'archive'), node(before, 'archive')) && node(c.afterRedoServer.definition, 'review').config.prompt.template.startsWith('The assistant step wrote:'));

// N3
const v = two.scenarios['N3 visuals: themes, 360 px, 200% zoom, forced colours, focus through remount'];
check('N3 completed', v.ok, v.error);
const longOld = 'collect_customer_feedback_from_the_quarterly_survey_results_273';
const longNew = 'summarize_customer_feedback_from_quarterly_survey_results_273';
const dd = v.variants['desktop-dark'];
check('over-long id refused with the existing message, nothing saved', dd.refusalText === 'Use a letter first, then letters, digits, _ or -' && dd.refusalAriaInvalid === 'true' && dd.serverAfterRefusalHasOldId === true, dd);
for (const [label, x] of Object.entries(v.variants)) {
  check(`${label}: notice shown with summary`, x.noticeText.includes(`Renamed ${longOld} to ${longNew}`) && x.noticeText.includes('Updated 1 reference in expressions, templates and mutation paths, and 3 connections.') && x.noticeText.includes('Review 2 places'), x.noticeText);
  check(`${label}: focus stays in Node id`, x.focusAfterEnter?.id === 'node-id', x.focusAfterEnter);
  check(`${label}: dialog notice has no horizontal overflow`, x.noticeOverflow.scrollWidth <= x.noticeOverflow.clientWidth, x.noticeOverflow);
  check(`${label}: page notice has no horizontal overflow`, x.pageNoticeOverflow.scrollWidth <= x.pageNoticeOverflow.clientWidth, x.pageNoticeOverflow);
  check(`${label}: page has no horizontal scroll`, x.pageOverflow.scrollWidth <= x.pageOverflow.clientWidth, x.pageOverflow);
  check(`${label}: row opens the exit at Returns`, x.focusAfterRowEnter?.field === 'returns', x.focusAfterRowEnter);
  check(`${label}: page Dismiss removes the notice`, x.pageNoticeAfterDismiss === 0);
  if (x.focusAfterClickRemount) {
    check(`${label}: click into remounted form keeps focus on Maximum passes`, x.focusAfterClickRemount.field === 'maxPasses' && x.focusAfterClickRemount.tag === 'INPUT', x.focusAfterClickRemount);
    check(`${label}: remounted Jsonata shows the repaired source`, x.jsonataAfter === 'counters.nodeVisits.check > 2 ? "stop" : "again"', x.jsonataAfter);
  }
}
check('N3 undo restored the original ids', Boolean(node(v.finalServer, longOld) && node(v.finalServer, 'gate')));

// N4
const m = one.scenarios['N4 known missing gate refused 422; optional probe publishes'];
check('N4 completed', m.ok, m.error);
const mp = m.network.filter((x) => x.method === 'POST' && x.path.endsWith('/publish'));
check('missing gate: save accepted', m.network.some((x) => x.method === 'PUT' && x.status === 200 && node(x.requestBody.definition, 'done').config.returns === 'gates.missing.passes'));
check('missing gate: publish 422 LOOP_INVALID with NODE_REFERENCE_MISSING', mp[0]?.status === 422 && mp[0].responseBody?.code === 'LOOP_INVALID' && mp[0].responseBody.errors?.some((e) => e.code === 'NODE_REFERENCE_MISSING'), mp[0]);
check('refusal keeps version 1 current', m.checks.currentAfterRefusal === m.v1.id);
check('optional probe is a warning', m.checks.popoverText.includes('NODE_REFERENCE_OPTIONAL_MISSING') && m.checks.popoverText.includes('Warning'), m.checks.popoverText);
check('optional probe publishes version 2', mp[1]?.status === 200 && m.checks.versions.length === 2 && m.checks.versions.find((x) => x.version === 1).returns === '"ok"' && m.checks.versions.find((x) => x.version === 2).returns === '$exists(gates.missing) ? 1 : 0', m.checks.versions);

// N5
const t = one.scenarios['N5 stale tab: 409 then Overwrite with the complete renamed draft'];
check('N5 completed', t.ok, t.error);
const tp = t.networkA.filter((x) => x.method === 'PUT');
check('stale rename PUT answered 409 DRAFT_CONFLICT', tp[0]?.status === 409 && tp[0].responseBody?.code === 'DRAFT_CONFLICT', tp[0]);
check('nothing overwritten during the conflict', Boolean(node(t.checks.serverDuringConflict, 'work')) && t.checks.serverDuringConflict.description === 'saved elsewhere');
check('overwrite PUT sends the complete renamed draft against the server token', tp[1]?.status === 200 && tp[1].ifMatch === `"${tp[0].responseBody?.draftToken}"` && isDeepStrictEqual(tp[1].requestBody.definition, t.checks.serverAfterOverwrite), { ifMatch: tp[1]?.ifMatch, token: tp[0]?.responseBody?.draftToken });
check('server after overwrite: renamed ids and repaired exit', isDeepStrictEqual(t.checks.serverAfterOverwrite.nodes.map((n) => n.id), ['start', 'draft', 'done']) && node(t.checks.serverAfterOverwrite, 'done').config.returns === 'outputs.draft.value');

// N6
const w = one.scenarios['N6 protected voice ids on a system Chat loop'];
check('N6 completed', w.ok, w.error);
for (const [id, p] of Object.entries(w.checks.protected)) check(`${id}: read-only id and Delete disabled`, p.readonly === '' && p.deleteDisabled === true, p);
check('respond rename repairs the envelope', w.checks.envelope === '{"protocol":"graphgoblin.chat.v1","reply":outputs.reply.value}', w.checks.envelope);
check('chat contract notice stays clear', w.checks.systemIssuesNotice === 0);

check('only expected console errors (the 422 and 409 answers)', [...one.console, ...two.console].every((e) => /status of (422|409)/.test(e.text ?? '')), [...one.console, ...two.console]);
const failed = results.filter((r) => !r.ok);
await writeFile(join(dir, 'native-verified.json'), JSON.stringify({ checked: results.length, failed: failed.length, results }, null, 2) + '\n');
console.log(`checked ${results.length}, failed ${failed.length}`);
for (const f of failed) console.log('FAIL', f.name, JSON.stringify(f.detail)?.slice(0, 600));
process.exit(failed.length ? 1 : 0);
