// Prints the compact evidence digests used by handoff.md (controls, retention, touch taps, dialog). Read-only.
//   node key-evidence.mjs <resume-dir>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
const J = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const L = (l) => J('analysis/' + l + '.json');
const A = (l) => J('runs/' + l + '/raw/' + l + '.actions.json');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- CONTROLS: injected temporary offsets; frame sampler and snapshots must see them and removal must restore exactly');
for (const cfg of ['d1', 'd2', 'n768', 'r512']) {
  const l = 'm2-control-' + cfg, r = await L(l), a = await A(l);
  const jumps = r.jumps.filter((j) => j.phase && /control/.test(j.phase)).map((j) => `${j.phase.replace('control-', 'c')}: Undo dx${j.undo.dx} dy${j.undo.dy} (Redo dx${j.redo.dx} dy${j.redo.dy})`);
  console.log(`${cfg}: frame-sampler jumps -> ${jumps.join(' | ')}`);
  console.log(`    snapshots: ${a.controls.map((c) => (c.during ? `${c.name.slice(0, 28)} Undo ${c.during.ub[0] - c.before.ub[0]},${c.during.ub[1] - c.before.ub[1]}; Redo ${c.during.rb[0] - c.before.rb[0]},${c.during.rb[1] - c.before.rb[1]}` : c.name.slice(0, 28) + ' (transient 1 frame)')).join(' | ')}`);
  console.log(`    removedExactly=${a.controls.map((c) => c.removedExactly).join(',')} restoredBoxesEqualBaseline=${a.controls.map((c) => same(c.after.ub, c.before.ub)).join(',')} oneFrameSeenByRaf=${r.jumps.some((j) => j.phase === 'control-one-frame' && j.undo.dy === 1)} removalSeen=${r.jumps.some((j) => j.phase === 'control-one-frame' && j.undo.dy === -1)}`);
}
console.log('--- RETENTION (h12): names, data-history, shortcuts, sizes, tab order, hit grid, keyboard, no-ops, focus');
for (const cfg of ['d1', 'd2', 'n768', 'r512']) {
  const r = await L('m2-h12-' + cfg), at = r.phaseResults.rest.attrs, gu = r.phaseResults.rest.gridU, gr = r.phaseResults.rest.gridR;
  console.log(`${cfg}: Undo ${JSON.stringify([at.undo.title, at.undo.dataHistory, at.undo.keyshortcuts, at.undo.width + 'x' + at.undo.height, 'tabIndex', at.undo.tabIndex, 'focusIdx', at.undo.focusOrderInHeader, 'domIdx', at.undo.domIndexInGroup, 'ariaDisabled', at.undo.ariaDisabled, 'disabledProp', at.undo.disabledProp])} Redo ${JSON.stringify([at.redo.title, at.redo.dataHistory, at.redo.keyshortcuts, at.redo.width + 'x' + at.redo.height, 'focusIdx', at.redo.focusOrderInHeader, 'domIdx', at.redo.domIndexInGroup])}`);
  console.log(`    grid Undo ${gu.hit}/${gu.total} Redo ${gr.hit}/${gr.total}; keys ${r.phaseResults.keys.map((k) => k.key + '=>' + k.nodeDelta).join(', ')}; clicks off-button ${r.actionSummary.clicksNotOnHistoryButton.length}; missing click ${r.actionSummary.noClickEvent.length}; no-ops w/o effect ${r.actionSummary.noOpsWithoutEffect}/${r.actionSummary.expectedNoOps}`);
  console.log(`    no-op clicks: ${r.actions.filter((a) => a.expectNoop).map((a) => `${a.spec}#${a.i} aria-disabled=${a.preAriaDisabled} nodeDelta=${a.nodeDelta} focusAfter=${a.focusAfter}`).join(' ; ')}`);
  console.log(`    focus after effective history clicks: ${[...new Set(r.actions.filter((a) => /^(undo|redo)$/.test(a.spec) && !a.expectNoop).map((a) => (a.focusAfter || '').split(' ')[0]))].join(' / ')}`);
}
console.log('--- D2 coarse touch taps (h12-d2)');
{
  const r = await L('m2-h12-d2'), a = await A('m2-h12-d2');
  console.log(`input=${a.input} actions=${r.actionSummary.total} effects=${r.actionSummary.enabledEffects} no-ops=${r.actionSummary.noOpsWithoutEffect}/${r.actionSummary.expectedNoOps} clicksOffButton=${r.actionSummary.clicksNotOnHistoryButton.length}`);
  console.log(r.actions.filter((x) => /^(undo|redo)$/.test(x.spec)).map((x) => `${x.spec}#${x.i} input=${x.input} down=${(x.downTarget || '-').slice(0, 14)} click->${(x.clickTarget || 'none').slice(0, 16)} trDown=${x.pressedTranslateAtDown} trUp=${x.pressedTranslateAtUp}`).join('\n'));
}
console.log('--- DIALOG');
for (const l of ['m2-dialog-d1', 'm2-dialog-r512']) {
  const r = await L(l), g = (k) => r.phaseResults[k];
  console.log(`${l}: modal=${g('dialog-state').modal} ariaModal=${g('dialog-state').ariaModal} name="${g('dialog-state').name}" hit@Undo=${g('dialog-state').undoHit} hit@Redo=${g('dialog-state').redoHit} undoInInert=${g('dialog-state').undoInInertSubtree}`);
  console.log(`    boxes rest->open: Undo ${JSON.stringify(g('open-dialog').restUb)} -> ${JSON.stringify(g('open-dialog').open.ub)}; Tab x24 reachedHistoryButton=${g('tab-sweep').reachedHistoryButton} allStopsInDialog=${g('tab-sweep').allInDialog}`);
  console.log(`    real click at Undo position: nodeDelta=${g('click-undo-through-dialog').nodeDelta} dialog ${g('click-undo-through-dialog').dialogBefore}->${g('click-undo-through-dialog').dialogAfter}; Ctrl+Z (focus on dialog heading): nodeDelta=${g('ctrl-z-in-dialog').nodeDelta} dialogStaysOpen=${g('ctrl-z-in-dialog').dialogAfter} focus=${g('ctrl-z-in-dialog').focusAfter} Undo ${JSON.stringify(g('ctrl-z-in-dialog').ubBefore)} -> ${JSON.stringify(g('ctrl-z-in-dialog').ubAfter)}; after Escape focus=${g('close-dialog').focus} dialogOpen=${g('close-dialog').dialogOpen}`);
}
