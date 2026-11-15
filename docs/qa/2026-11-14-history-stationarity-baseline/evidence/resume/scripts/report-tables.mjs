// Builds analysis/report-tables.md from analysis/<label>.json (no browser). Usage:
//   node report-tables.mjs <resume-dir>
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
const dir = join(root, 'analysis');
const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
const A = {};
for (const f of files) { const j = JSON.parse(await readFile(join(dir, f), 'utf8')); A[j.label] = j; }
const m2 = Object.keys(A).filter((l) => l.startsWith('m2-'));
const cfgOrder = ['d1', 'd2', 'n768', 'r512'];
const cfgLabel = { d1: 'D1 1440x900 fine, app light', d2: 'D2 1440x900 coarse, app dark', n768: 'N768 768x900 fine, app light', r512: 'R512 512x384 @DPR2 (200% reflow) fine, app light' };
const by = (kase, cfg, prefix = 'm2-') => A[prefix + kase + '-' + cfg];
const f1 = (n) => (n === null || n === undefined ? '-' : (Math.round(n * 100) / 100).toString());
const md = [];
const push = (s = '') => md.push(s);

push('## T0 run inventory');
push('| run | config | app theme | scheme | viewport | DPR | pointer | root font | phases failed | frames | cadence median/p99/max ms |');
push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const l of Object.keys(A).sort()) {
  const r = A[l]; const m = r.meta || {};
  const failed = Object.entries(r.phases).filter(([, p]) => p.ok === false).map(([n]) => n).join(',') || '-';
  push(`| \`${l}\` | ${r.config} | ${m.appTheme || (l.startsWith('m2-') ? '?' : 'dark (m1: not applied)')} | ${m.scheme || '-'} | ${m.w}x${m.h} | ${m.dpr} | ${m.pointerCoarse ? 'coarse' : 'fine'} | ${m.rootFont} | ${failed} | ${r.frames} | ${r.cadence.medianMs}/${r.cadence.p99Ms}/${r.cadence.maxMs} |`);
}

push('\n## T1 H1/H2: label-width-driven displacement of Undo/Redo (per fixed config)');
for (const cfg of cfgOrder) {
  for (const kase of ['h12', 'h12held']) {
    const r = by(kase, cfg); if (!r) continue;
    push(`\n### ${cfgLabel[cfg]} — ${kase}${r.nameMode === 'long' ? ' (120-char name)' : ''} (\`${r.label}\`)`);
    push(`Rest box Undo ${JSON.stringify(r.base && r.base.ub)} Redo ${JSON.stringify(r.base && r.base.rb)}; load-time shift first paint -> rest: dx ${r.loadTime && r.loadTime.dxToRest}, dy ${r.loadTime && r.loadTime.dyToRest} (labels at first paint: ${r.loadTime && r.loadTime.firstLabels ? r.loadTime.firstLabels.val : '-'}). Header heights seen: ${r.overall.headerHeights.join('/')}; editor-frame y seen: ${r.overall.frameY.join('/')}.`);
    push(`Jumps >=0.9px: ${r.jumpCount}; by cause ${JSON.stringify(r.jumpCauseTally)}; max |dx| Undo ${r.overall.undo.maxAbsDx}, max |dy| Undo ${r.overall.undo.maxAbsDy} (dy includes the 0..1px pressed transition).`);
    push('| t ms | phase | Undo x,y before -> after | dx | dy | Redo dx | label change that coincided |');
    push('|---|---|---|---|---|---|---|');
    for (const j of r.jumps) push(`| ${f1(j.t)} | ${j.phase || 'load'} | ${j.undo.from.join(',')} -> ${j.undo.to.join(',')} | ${j.undo.dx} | ${j.undo.dy} | ${j.redo.dx} | ${(j.cause || ['(none)']).filter((c) => !/^(uT|rT|uAD|rAD|nodes|notices)/.test(c)).join('; ').replace(/\|/g, '/')} |`);
    push('Label widths seen (validation | publish -> val w, publish w, group w, resulting Undo x): ' + Object.entries(r.variableWidths).map(([k, v]) => `${k}: ${v.valW}/${v.pubW}/${v.groupW}/${f1(v.undoX)}`).join('; '));
    push(`Baseline-position hit tests: baseline Undo centre not Undo in ${r.hitTests.baselineUndoCentreNotUndoFrames}/${r.hitTests.framesChecked} frames; baseline Redo centre not Redo in ${r.hitTests.baselineRedoCentreNotRedoFrames} frames; spans ${JSON.stringify(r.hitTests.redoSpansMs.slice(0, 4))}; Redo-centre landed on ${JSON.stringify(r.hitTests.redoLandedOn)}.`);
    push(`Actions: ${JSON.stringify(r.actionSummary)}.`);
    const mouse = r.actions.filter((a) => /^(undo|redo)$/.test(a.spec));
    const moved = mouse.filter((a) => a.downToUpMovedUndo && (Math.abs(a.downToUpMovedUndo[0]) >= 0.9 || Math.abs(a.downToUpMovedUndo[1]) >= 0.9));
    push(`History clicks: ${mouse.length}; clicks whose Undo box moved >=0.9px between pointer-down and pointer-up: ${moved.length}${moved.length ? ' (' + moved.map((a) => `#${a.i}:${JSON.stringify(a.downToUpMovedUndo)}`).join(', ') + ')' : ''}.`);
    const pot = r.phaseResults['press-over-transition'];
    if (pot) push(`Press held across async save/validate transition: ${JSON.stringify({ savingSeen: pot.savingSeen, flipSeen: pot.flipSeen, flipAfterDownMs: pot.flipAfterDownMs, downBox: pot.downBox, upBox: pot.upBox, undoEffect: pot.undoEffect, heldMs: pot.heldMs })}.`);
    const pub = r.phaseResults.publish;
    if (pub && pub.pre) push(`Publish with POST /publish held 1500 ms: Undo ${JSON.stringify(pub.pre.ub)} -> ${JSON.stringify(pub.busy && pub.busy.ub)} while "Publishing…" (publish button ${JSON.stringify(pub.publishButton && pub.publishButton.box)}); published after ${pub.publishedAfterClickMs} ms; badge ${pub.pre.badge} -> ${pub.done && pub.done.badge}.`);
  }
}

push('\n## T2 H3: pressed 1px movement');
push('| run | button state | rest translate | pressed translate (afterDown ms) | dy from rest while held | after release | integer rows rest [in-top,in-bottom,out-above,out-below] | integer rows held |');
push('|---|---|---|---|---|---|---|---|');
for (const cfg of cfgOrder) {
  const r = by('h3', cfg); if (!r || !r.presses) continue;
  for (const p of r.presses) {
    const rows = (x) => (x ? [x.insideTopRow[2], x.insideBottomRow[2], x.outsideAboveRow[2], x.outsideBelowRow[2]].join('/') : '-');
    push(`| \`${r.label}\` | ${p.name} | ${p.restTranslate} | ${p.held.map((h) => `${h.translate} (${h.afterDownMs})`).join('; ')} | ${p.held.map((h) => h.dyFromRest).join('/')} | ${p.afterUp40 && p.afterUp40.translate} -> ${p.afterUp340 && p.afterUp340.translate} | ${rows(p.intRowsRest)} | ${rows(p.intRowsHeld)} |`);
  }
  const ks = r.phaseResults['keyboard-space-hold'];
  if (ks) push(`| \`${r.label}\` | keyboard Space held on focused Undo | - | ${ks.during && ks.during.translate} | ${ks.during && ks.during.box ? ks.during.box[1] - r.base.ub[1] : '-'} | node delta ${ks.nodeDelta} | - | - |`);
  const th = r.phaseResults['touch-hold-cdp'];
  if (th) push(`| \`${r.label}\` | CDP touch hold on Redo | - | ${th.skipped ? 'skipped: ' + th.skipped : (th.during && th.during.translate)} | ${th.during && th.during.box ? th.during.box[1] - r.base.rb[1] : '-'} | node delta ${th.nodeDelta} | - | - |`);
}
push('\n### Edge-click loss (integer-aligned presses on an enabled Undo)');
push('| run | press point | hold ms | rest box y | held box y | hit at down | hit while held | mouseup target | click target | history effect (node delta) |');
push('|---|---|---|---|---|---|---|---|---|---|');
for (const cfg of cfgOrder) {
  const r = by('h3', cfg); if (!r || !r.edgeClickLoss) continue;
  for (const e of r.edgeClickLoss) {
    const mu = e.events.find((v) => v.type === 'mouseup'), ck = e.events.find((v) => v.type === 'click');
    push(`| \`${r.label}\` | ${e.name} @ (${f1(e.point[0])}, ${e.point[1]}) | ${e.hold} | ${e.restBox[1]} | ${f1(e.heldBox[1])} | ${e.hitAtDown} | ${e.hitWhileHeld} | ${mu ? mu.tg.slice(0, 30) : '-'} | ${ck ? ck.tg.slice(0, 30) : 'none'} | ${e.nodeDelta} |`);
  }
}

push('\n## T4 H4: connection banner');
push('| run | mode | appeared after fault-on ms | shell shift px (editor frame y) | Undo y shift px | doc overflow px | appearances | total shown ms | stuck at restore? | banner gone after restore ms | saved after restore ms | actions pressed during banner | save label while faulted | hit-test: baseline Undo centre landed on |');
push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const cfg of cfgOrder) for (const mode of ['h4offline', 'h4transportall', 'h4transportput', 'h4http500']) {
  const r = by(mode, cfg); if (!r) continue;
  const rec = r.phaseResults.recovery || {};
  const pressed = (r.shell.intervals || []).flatMap((v) => v.actionsPressedDuring);
  const saves = [...new Set(r.labelChanges.flatMap((c) => c.changed).filter((c) => c.startsWith('save:')).map((c) => c.split(' -> ')[1]))];
  push(`| \`${r.label}\` | ${mode.slice(2)} | ${r.shell.firstAppearanceAfterFaultOnMs ?? '-'} | ${r.shell.maxShiftPx} | ${r.shell.maxUndoDyPx} | ${r.scroll.maxOverflowPx} | ${r.shell.appearances} | ${r.shell.totalMs} | ${r.shell.stillShownAtFaultOff ?? '-'} | ${rec.bannerGoneAfterRestoreMs ?? 'not within ' + rec.deadlineMs} | ${rec.savedAfterRestoreMs ?? 'not within ' + rec.deadlineMs} | ${pressed.join(',') || '-'} | ${saves.join(' / ')} | ${(r.hitTests.undoLandedOn || []).map((s) => s.slice(0, 26)).join(' / ')} |`);
}

push('\n## T5 retention, hit targets, focus, no-ops');
push('| run | Undo title/data-history/shortcuts | Redo title/data-history/shortcuts | size | tab order idx (undo,redo) | rest hit grid Undo/Redo | enabled effects | no-ops w/o effect | clicks off-button | focus after last click |');
push('|---|---|---|---|---|---|---|---|---|---|');
for (const cfg of cfgOrder) for (const kase of ['h12']) {
  const r = by(kase, cfg); if (!r) continue;
  const at = r.phaseResults.rest && r.phaseResults.rest.attrs; if (!at) continue;
  const gu = r.phaseResults.rest.gridU, gr = r.phaseResults.rest.gridR;
  const last = r.actions.filter((a) => /^(undo|redo)$/.test(a.spec)).at(-1);
  push(`| \`${r.label}\` | ${at.undo.title} / ${at.undo.dataHistory} / ${at.undo.keyshortcuts} | ${at.redo.title} / ${at.redo.dataHistory} / ${at.redo.keyshortcuts} | ${at.undo.width}x${at.undo.height} | ${at.undo.focusOrderInHeader},${at.redo.focusOrderInHeader} | ${gu.hit}/${gu.total} ${gr.hit}/${gr.total} | ${r.actionSummary.enabledEffects}/10 | ${r.actionSummary.noOpsWithoutEffect}/2 | ${r.actionSummary.clicksNotOnHistoryButton.length} | ${last ? last.focusAfter : '-'} |`);
}
const keys = (cfg) => { const r = by('h12', cfg); return r && r.phaseResults.keys; };
push('\nKeyboard shortcuts (focus on the Undo/Redo button, no text editor): ' + cfgOrder.map((c) => { const k = keys(c); return k ? `${c}: ` + k.map((x) => `${x.key}=>${x.nodeDelta}`).join(', ') : null; }).filter(Boolean).join(' | '));

push('\n## T6 dialog');
for (const cfg of cfgOrder) { const r = by('dialog', cfg); if (!r) continue; const g = (k) => r.phaseResults[k];
  push(`\n### ${cfgLabel[cfg]} (\`${r.label}\`)`);
  push('- dialog state: ' + JSON.stringify({ ...g('dialog-state'), undoBox: undefined, redoBox: undefined }));
  push('- Undo/Redo boxes while open: ' + JSON.stringify({ rest: [g('open-dialog').restUb, g('open-dialog').restRb], open: [g('open-dialog').open.ub, g('open-dialog').open.rb] }));
  push('- Tab sweep (24 presses): reached a history button = ' + g('tab-sweep').reachedHistoryButton + '; every stop inside dialog = ' + g('tab-sweep').allInDialog);
  push('- real pointer click at Undo position through the modal: ' + JSON.stringify(g('click-undo-through-dialog')));
  push('- Ctrl+Z with focus on the dialog heading: ' + JSON.stringify(g('ctrl-z-in-dialog')));
  push('- after Escape: ' + JSON.stringify({ ...g('close-dialog'), undoGrid: undefined, screenshot: undefined }));
}
await writeFile(join(dir, 'report-tables.md'), md.join('\n') + '\n');
console.log('tables written:', md.length, 'lines; m2 runs analysed:', m2.length);
