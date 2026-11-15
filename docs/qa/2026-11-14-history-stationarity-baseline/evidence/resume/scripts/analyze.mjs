// Offline analysis of the raw sink payloads (no browser, no gateway). Usage:
//   node analyze.mjs <resume-dir> [label ...]     (default: every runs/<label>/raw/<label>.frames.json)
// Writes analysis/<label>.json and analysis/matrix.md. Re-runnable: it never modifies raw data.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
const wanted = process.argv.slice(3);
const runsDir = join(root, 'runs');
const outDir = join(root, 'analysis');
await mkdir(outDir, { recursive: true });
const labels = wanted.length ? wanted : (await readdir(runsDir, { withFileTypes: true })).filter((d) => d.isDirectory() && existsSync(join(runsDir, d.name, 'raw', d.name + '.frames.json'))).map((d) => d.name).sort();
const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 1000) / 1000);
const JUMP = 0.9; // px between consecutive frames; the pressed-translate transition moves < 0.35 px/frame

function diffKeys(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (JSON.stringify(a ? a[k] : undefined) !== JSON.stringify(b ? b[k] : undefined)) out.push({ key: k, from: a ? a[k] : null, to: b ? b[k] : null });
  return out;
}

const rows = [];
for (const label of labels) {
  const dir = join(runsDir, label);
  const framesFile = JSON.parse(await readFile(join(dir, 'raw', label + '.frames.json'), 'utf8'));
  const actionsFile = JSON.parse(await readFile(join(dir, 'raw', label + '.actions.json'), 'utf8'));
  const run = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  const F = framesFile.frames, E = framesFile.events, epoch0 = framesFile.epoch0;
  const load = actionsFile.phases.find((p) => p.name === 'load');
  const base = load && load.result && load.result.base ? load.result.base : null;
  const markAt = (name) => { const e = E.find((x) => x.type === 'mark' && x.name === name); return e ? e.t : null; };
  const lastMark = (name) => { const l = E.filter((x) => x.type === 'mark' && x.name === name); return l.length ? l[l.length - 1].t : null; };
  const toFrameT = (epochMs) => epochMs - epoch0;
  const res = { label, scenario: actionsFile.scenario, config: actionsFile.config, nameMode: actionsFile.nameMode, input: actionsFile.input, loopName: actionsFile.loopName,
    meta: actionsFile.meta, run: { driverExit: run.driverExit, failure: run.failure, pageErrors: run.pageErrors, harnessError: run.harnessError || null, gatewayExit: run.gatewayExit, browserClose: run.browserClose, store: run.store && { removed: run.store.removed, residualLockWalShm: run.store.residualLockWalShm, sqliteFilePresent: run.store.sqliteFilePresent }, ports: { origin: run.origin, sink: run.sinkOrigin }, pids: { orchestrator: run.orchestratorPid, gateway: run.gatewayPid, browser: run.browserPid } },
    base, frames: F.length, events: E.length, appTheme: actionsFile.meta ? (actionsFile.meta.appTheme || (actionsFile.meta.scheme && null)) : null };
  // frame cadence
  const dts = []; for (let i = 1; i < F.length; i++) dts.push(F[i].t - F[i - 1].t);
  dts.sort((a, b) => a - b);
  res.cadence = { medianMs: r2(dts[Math.floor(dts.length / 2)]), p99Ms: r2(dts[Math.floor(dts.length * 0.99)]), maxMs: r2(dts[dts.length - 1]) };
  // phase windows on the in-page clock
  const phases = {};
  for (const p of actionsFile.phases) { const s = markAt('phase:' + p.name + ':start'), e = lastMark('phase:' + p.name + ':end'); phases[p.name] = { startT: s, endT: e, ok: p.ok, error: p.error ? p.error.split('\n')[0] : undefined }; }
  res.phases = phases;
  const inWin = (f, w) => w && w.startT !== null && w.endT !== null && f.t >= w.startT && f.t <= w.endT;
  // displacement vs the fixed-config rest box, whole run and per phase
  const disp = (frames) => {
    const o = { n: 0, undo: { maxAbsDx: 0, maxAbsDy: 0, minX: null, maxX: null, minY: null, maxY: null }, redo: { maxAbsDx: 0, maxAbsDy: 0 }, headerHeights: new Set(), frameY: new Set(), toolbarWrapRows: new Set() };
    for (const f of frames) {
      if (!f.u || !f.r || !base) continue;
      o.n++;
      const dxu = f.u[0] - base.ub[0], dyu = f.u[1] - base.ub[1], dxr = f.r[0] - base.rb[0], dyr = f.r[1] - base.rb[1];
      o.undo.maxAbsDx = Math.max(o.undo.maxAbsDx, Math.abs(dxu)); o.undo.maxAbsDy = Math.max(o.undo.maxAbsDy, Math.abs(dyu));
      o.redo.maxAbsDx = Math.max(o.redo.maxAbsDx, Math.abs(dxr)); o.redo.maxAbsDy = Math.max(o.redo.maxAbsDy, Math.abs(dyr));
      o.undo.minX = o.undo.minX === null ? f.u[0] : Math.min(o.undo.minX, f.u[0]); o.undo.maxX = o.undo.maxX === null ? f.u[0] : Math.max(o.undo.maxX, f.u[0]);
      o.undo.minY = o.undo.minY === null ? f.u[1] : Math.min(o.undo.minY, f.u[1]); o.undo.maxY = o.undo.maxY === null ? f.u[1] : Math.max(o.undo.maxY, f.u[1]);
      if (f.h) o.headerHeights.add(f.h[3]); if (f.fr) o.frameY.add(f.fr[1]);
    }
    o.undo.maxAbsDx = r2(o.undo.maxAbsDx); o.undo.maxAbsDy = r2(o.undo.maxAbsDy); o.redo.maxAbsDx = r2(o.redo.maxAbsDx); o.redo.maxAbsDy = r2(o.redo.maxAbsDy);
    o.undo.minX = r2(o.undo.minX); o.undo.maxX = r2(o.undo.maxX); o.undo.minY = r2(o.undo.minY); o.undo.maxY = r2(o.undo.maxY);
    o.headerHeights = [...o.headerHeights].sort((a, b) => a - b); o.frameY = [...o.frameY].sort((a, b) => a - b);
    return o;
  };
  res.overall = disp(F.filter((f) => !base || f.t >= (phases.rest ? phases.rest.startT || 0 : 0)));
  res.byPhase = {};
  for (const name of Object.keys(phases)) if (phases[name].startT !== null && phases[name].endT !== null) { const d = disp(F.filter((f) => inWin(f, phases[name]))); if (d.n) res.byPhase[name] = { n: d.n, undo: d.undo, redo: d.redo, headerHeights: d.headerHeights, frameY: d.frameY }; }
  // first-paint -> rest (load-time) shift
  const firstWithU = F.find((f) => f.u);
  res.loadTime = firstWithU && base ? { firstUndoBox: firstWithU.u, firstT: r2(firstWithU.t), restUndoBox: base.ub, dxToRest: r2(base.ub[0] - firstWithU.u[0]), dyToRest: r2(base.ub[1] - firstWithU.u[1]), firstLabels: firstWithU.x || null } : null;
  // text-state timeline and jumps with attributed causes
  const state = [];
  let cur = null;
  const idxState = new Array(F.length);
  for (let i = 0; i < F.length; i++) { if (F[i].x) { state.push({ i, t: F[i].t, from: cur, to: F[i].x, changed: diffKeys(cur, F[i].x) }); cur = F[i].x; } idxState[i] = state.length - 1; }
  res.labelChanges = state.slice(1).map((s) => ({ t: r2(s.t), changed: s.changed.filter((c) => !['uT', 'rT'].includes(c.key) || true).map((c) => c.key + ': ' + JSON.stringify(c.from) + ' -> ' + JSON.stringify(c.to)) }));
  const jumps = [];
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i];
    if (!a.u || !b.u) continue;
    const du = [b.u[0] - a.u[0], b.u[1] - a.u[1]], dr = a.r && b.r ? [b.r[0] - a.r[0], b.r[1] - a.r[1]] : [0, 0];
    if (Math.hypot(du[0], du[1]) >= JUMP || Math.hypot(dr[0], dr[1]) >= JUMP) {
      // nearest preceding text change within 80 ms (inclusive of this frame)
      let cause = null;
      for (let s = idxState[i]; s >= 0; s--) { if (b.t - state[s].t > 80) break; if (s > 0) { cause = state[s]; break; } }
      const geo = {};
      if (a.h && b.h && a.h[3] !== b.h[3]) geo.headerHeight = [a.h[3], b.h[3]];
      if (a.fr && b.fr && a.fr[1] !== b.fr[1]) geo.frameY = [a.fr[1], b.fr[1]];
      if ((a.b === null || a.b === undefined) !== (b.b === null || b.b === undefined)) geo.banner = [a.b ? a.b[3] : null, b.b ? b.b[3] : null];
      if (a.sc && b.sc && (a.sc[2] !== b.sc[2] || a.sc[5] !== b.sc[5])) geo.scroll = [[a.sc[2], a.sc[3], a.sc[5]], [b.sc[2], b.sc[3], b.sc[5]]];
      jumps.push({ t: r2(b.t), phase: Object.keys(phases).find((n) => inWin(b, phases[n])) || null, undo: { from: a.u.slice(0, 2), to: b.u.slice(0, 2), dx: r2(du[0]), dy: r2(du[1]) }, redo: { dx: r2(dr[0]), dy: r2(dr[1]) },
        cause: cause ? cause.changed.map((c) => c.key + ': ' + JSON.stringify(c.from) + ' -> ' + JSON.stringify(c.to)) : null, geo });
    }
  }
  res.jumps = jumps;
  res.jumpCount = jumps.length;
  // cause tally by the label key that changed
  const tally = {};
  for (const j of jumps) { const k = j.cause ? j.cause.map((c) => c.split(':')[0]).filter((k) => !['nodes', 'uT', 'rT', 'uAD', 'rAD'].includes(k)).sort().join('+') || 'history-state-only' : 'no-label-change'; tally[k] = (tally[k] || 0) + 1; }
  res.jumpCauseTally = tally;
  // widths of the content that varies
  const widths = {};
  for (const f of F) { if (f.x && f.v) { const k = (f.x.val || '?') + ' | ' + (f.x.pub || '?'); widths[k] = widths[k] || { valW: r2(f.v[2]), pubW: f.p ? r2(f.p[2]) : null, groupW: f.g ? r2(f.g[2]) : null, undoX: f.u ? f.u[0] : null }; } }
  res.variableWidths = widths;
  // viewport / scroll
  const scrollInfo = { maxScrollY: 0, maxOverflowPx: 0, scrollbarWidthPx: new Set(), innerWidths: new Set(), innerHeights: new Set(), visualViewportScale: new Set() };
  for (const f of F) { if (!f.sc) continue; scrollInfo.maxScrollY = Math.max(scrollInfo.maxScrollY, f.sc[1]); if (f.sc[2] !== null && f.sc[3] !== null) scrollInfo.maxOverflowPx = Math.max(scrollInfo.maxOverflowPx, f.sc[2] - f.sc[3]); if (f.sc[5] !== null) scrollInfo.scrollbarWidthPx.add(f.vp[0] - f.sc[5]); scrollInfo.innerWidths.add(f.vp[0]); scrollInfo.innerHeights.add(f.vp[1]); scrollInfo.visualViewportScale.add(f.vp[5]); }
  for (const k of ['scrollbarWidthPx', 'innerWidths', 'innerHeights', 'visualViewportScale']) scrollInfo[k] = [...scrollInfo[k]];
  res.scroll = scrollInfo;
  const scrollEvents = E.filter((e) => e.type === 'scroll').map((e) => ({ t: r2(e.t), tg: e.tg, sy: e.sy, top: e.top }));
  res.scrollEvents = scrollEvents.length > 12 ? { count: scrollEvents.length, first: scrollEvents.slice(0, 6) } : { count: scrollEvents.length, all: scrollEvents };
  // hit tests: where the baseline centres now land
  const hitAfter = F.filter((f) => base && f.hu !== undefined && f.t >= (phases.rest && phases.rest.startT ? phases.rest.startT : 0));
  const notUndo = hitAfter.filter((f) => !(f.hu || '').startsWith('button[undo]')), notRedo = hitAfter.filter((f) => !(f.hr || '').startsWith('button[redo]'));
  const spans = (list) => { const out = []; let s = null, p = null; for (const f of list) { if (s === null) s = f; else if (f.t - p.t > 40) { out.push([r2(s.t), r2(p.t)]); s = f; } p = f; } if (s) out.push([r2(s.t), r2(p.t)]); return out; };
  res.hitTests = { framesChecked: hitAfter.length, baselineUndoCentreNotUndoFrames: notUndo.length, baselineRedoCentreNotRedoFrames: notRedo.length, undoSpansMs: spans(notUndo).slice(0, 12), redoSpansMs: spans(notRedo).slice(0, 12),
    undoLandedOn: [...new Set(notUndo.map((f) => f.hu))].slice(0, 6), redoLandedOn: [...new Set(notRedo.map((f) => f.hr))].slice(0, 6),
    currentCentreNotHistoryFrames: F.filter((f) => f.u && !(f.cu || '').startsWith('button[undo]') || f.r && !(f.cr || '').startsWith('button[redo]')).length };
  // per-action pointer evidence
  const marks = E.filter((e) => e.type === 'mark' && /^act:\d+:/.test(e.name));
  const acts = [];
  for (const a of actionsFile.actions) {
    const m = marks.find((x) => x.name.startsWith('act:' + a.i + ':'));
    const next = marks.find((x) => x.t > (m ? m.t : 0) && x.name !== (m && m.name));
    const evs = m ? E.filter((e) => e.t >= m.t && e.t < (next ? next.t : m.t + 900) && ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'touchend'].includes(e.type)) : [];
    const ev = (t) => evs.find((e) => e.type === t);
    const dn = ev('mousedown') || ev('pointerdown') || ev('touchstart'), up = ev('mouseup') || ev('pointerup') || ev('touchend'), ck = ev('click');
    acts.push({ i: a.i, spec: a.spec, input: a.input, expectNoop: a.expectNoop || false, preAriaDisabled: a.preAriaDisabled || null, nodeDelta: a.nodeDelta === undefined ? null : a.nodeDelta, expectDelta: a.expectDelta === undefined ? null : a.expectDelta, effectOk: a.deltaMatches === undefined ? null : a.deltaMatches,
      downTarget: dn ? dn.tg : null, upTarget: up ? up.tg : null, clickTarget: ck ? ck.tg : null, clickOnHistoryButton: ck ? !!ck.hist : null,
      undoBoxAtDown: dn && dn.f ? dn.f.u : null, undoBoxAtUp: up && up.f ? up.f.u : null, redoBoxAtDown: dn && dn.f ? dn.f.r : null, redoBoxAtUp: up && up.f ? up.f.r : null,
      downToUpMovedUndo: dn && up && dn.f && up.f && dn.f.u && up.f.u ? [r2(up.f.u[0] - dn.f.u[0]), r2(up.f.u[1] - dn.f.u[1])] : null,
      pressedTranslateAtUp: up ? up.tr || null : null, pressedTranslateAtDown: dn ? dn.tr || null : null,
      tDown: dn ? r2(dn.t) : null, tUp: up ? r2(up.t) : null, aimedCentre: a.c2 ? [r2(a.c2.x), r2(a.c2.y)] : null, boxAtAim: a.c2 ? a.c2.box.map(r2) : null, focusAfter: a.post ? a.post.focus : null });
  }
  res.actions = acts;
  res.actionSummary = { total: acts.length, enabledEffects: acts.filter((a) => !a.expectNoop && a.effectOk === true).length, expectedNoOps: acts.filter((a) => a.expectNoop).length, noOpsWithoutEffect: acts.filter((a) => a.expectNoop && a.nodeDelta === 0).length,
    effectMismatches: acts.filter((a) => a.effectOk === false).map((a) => a.i), clicksNotOnHistoryButton: acts.filter((a) => /^(undo|redo)$/.test(a.spec) && a.clickOnHistoryButton === false).map((a) => a.i), noClickEvent: acts.filter((a) => /^(undo|redo)$/.test(a.spec) && a.clickOnHistoryButton === null).map((a) => a.i) };
  // banner events
  res.bannerEvents = E.filter((e) => e.type === 'banner' || e.type === 'win:offline' || e.type === 'win:online').map((e) => ({ t: r2(e.t), type: e.type, sig: e.sig || null, bannerBox: e.f && e.f.b ? e.f.b : null, frameY: e.f && e.f.fr ? e.f.fr[1] : null, undo: e.f ? e.f.u : null, redo: e.f ? e.f.r : null, headerH: e.f && e.f.h ? e.f.h[3] : null, scroll: e.f ? e.f.sc : null, innerW: e.f ? e.f.vp[0] : null }));
  // shell-banner intervals judged by the editor frame's y shift (robust to the banner text/finder)
  {
    const restFrames = F.filter((f) => f.fr && phases.rest && phases.rest.startT !== null && f.t >= phases.rest.startT && f.t <= (phases.rest.endT || phases.rest.startT + 800));
    const ys = restFrames.map((f) => f.fr[1]).sort((a, b) => a - b);
    const baseFrameY = ys.length ? ys[Math.floor(ys.length / 2)] : (F.find((f) => f.fr) || { fr: [null, null] }).fr[1];
    const ivs = []; let cur = null; let curText = null;
    for (let i = 0; i < F.length; i++) {
      const f = F[i]; if (!f.fr) continue;
      if (f.x && f.x.ban !== undefined) curText = f.x.ban;
      const shift = f.fr[1] - baseFrameY;
      if (shift >= 1) { if (!cur) cur = { startT: r2(f.t), endT: r2(f.t), maxShift: 0, maxUndoDy: 0, maxOverflowPx: 0, text: curText, texts: new Set() }; cur.endT = r2(f.t); cur.maxShift = Math.max(cur.maxShift, shift); if (f.u && base) cur.maxUndoDy = Math.max(cur.maxUndoDy, f.u[1] - base.ub[1]); if (f.sc && f.sc[2] !== null) cur.maxOverflowPx = Math.max(cur.maxOverflowPx, f.sc[2] - f.sc[3]); if (curText) cur.texts.add(curText.slice(0, 40)); }
      else if (cur) { ivs.push(cur); cur = null; }
    }
    if (cur) ivs.push(cur);
    for (const iv of ivs) { iv.durationMs = r2(iv.endT - iv.startT + 8); iv.texts = [...iv.texts]; iv.actionsPressedDuring = acts.filter((a) => a.tDown !== null && a.tDown >= iv.startT && a.tDown <= iv.endT + 8).map((a) => a.i); iv.actionsReleasedDuring = acts.filter((a) => a.tUp !== null && a.tUp >= iv.startT && a.tUp <= iv.endT + 8).map((a) => a.i); }
    res.shell = { baseFrameY, appearances: ivs.length, maxShiftPx: ivs.reduce((m, v) => Math.max(m, v.maxShift), 0), maxUndoDyPx: ivs.reduce((m, v) => Math.max(m, v.maxUndoDy), 0), totalMs: r2(ivs.reduce((m, v) => m + v.durationMs, 0)), intervals: ivs.slice(0, 20) };
    const fw = actionsFile.faultWindow;
    if (fw && fw.onAt && ivs.length) res.shell.firstAppearanceAfterFaultOnMs = r2(ivs[0].startT - (fw.onAt - epoch0));
    if (fw && fw.offAt) { const lastIv = ivs[ivs.length - 1]; res.shell.lastDisappearanceAfterFaultOffMs = lastIv ? r2(lastIv.endT + 8 - (fw.offAt - epoch0)) : null; res.shell.stillShownAtFaultOff = ivs.some((v) => v.startT <= fw.offAt - epoch0 && v.endT >= fw.offAt - epoch0 - 8); }
  }
  // requests, holds, aborts
  const rq = actionsFile.requests, rt = actionsFile.routes;
  res.network = { requests: rq.length, byTag: rq.reduce((m, r) => { const k = r.m + ' ' + r.p; m[k] = (m[k] || 0) + 1; return m; }, {}), failed: rq.filter((r) => r.failed).map((r) => ({ tMs: r.t - actionsFile.T0, m: r.m, p: r.p, failed: r.failed })).slice(0, 60),
    non2xx: rq.filter((r) => r.status && r.status >= 300).map((r) => ({ tMs: r.t - actionsFile.T0, m: r.m, p: r.p, status: r.status })).slice(0, 60),
    held: rt.filter((r) => r.action === 'hold').map((r) => ({ tMs: r.t - actionsFile.T0, tag: r.tag, holdMs: r.holdMs, releasedAfterMs: r.releasedAt ? r.releasedAt - r.t : null })), aborted: rt.filter((r) => r.action === 'abort').length, fulfilled500: rt.filter((r) => r.action === 'fulfill500').length,
    puts: rq.filter((r) => r.m === 'PUT').map((r) => ({ tMs: r.t - actionsFile.T0, nodes: r.putNodes, status: r.status || null, failed: r.failed || null })) };
  res.phaseResults = Object.fromEntries(actionsFile.phases.filter((p) => p.result !== undefined).map((p) => [p.name, p.result]));
  res.actionsFile = { presses: actionsFile.presses ? actionsFile.presses.length : 0, controls: actionsFile.controls ? actionsFile.controls.length : 0, faultWindow: actionsFile.faultWindow || null };
  // press analysis (H3)
  if (actionsFile.presses) {
    res.presses = actionsFile.presses.map((p) => {
      const restY = p.restPress && p.restPress.box ? p.restPress.box[1] : null;
      const heldY = p.held.map((h) => (h.p && h.p.box ? r2(h.p.box[1] - restY) : null));
      return { name: p.name, ariaDisabledAtStart: p.pre && (p.sel.includes('undo') ? p.pre.uAD : p.pre.rAD), restBox: p.restPress && p.restPress.box, restTranslate: p.restPress && p.restPress.translate, hoverTranslate: p.hoverPress && p.hoverPress.translate,
        held: p.held.map((h, k) => ({ afterDownMs: h.tRel, translate: h.p && h.p.translate, transform: h.p && h.p.transform, active: h.p && h.p.active, dyFromRest: heldY[k], elementAtCentre: h.cu })),
        maxPressedDy: heldY.length ? Math.max(...heldY.filter((v) => v !== null)) : null, transition: p.restPress && p.restPress.transition,
        restGrid: p.restGrid && { hit: p.restGrid.hit, total: p.restGrid.total, miss: p.restGrid.miss }, heldGrid: p.heldGrid && { hit: p.heldGrid.hit, total: p.heldGrid.total, miss: p.heldGrid.miss },
        afterUp40: p.afterUp40 && { translate: p.afterUp40.translate, dyFromRest: p.afterUp40.box ? r2(p.afterUp40.box[1] - restY) : null }, afterUp340: p.afterUp340 && { translate: p.afterUp340.translate, dyFromRest: p.afterUp340.box ? r2(p.afterUp340.box[1] - restY) : null },
        nodeDelta: p.post.nodes - p.pre.nodes, focusAfter: p.post.focus, movedOffBeforeUp: !!p.movedOff };
    });
  }
  if (res.presses) for (const p of res.presses) { const src = actionsFile.presses.find((x) => x.name === p.name); p.intRowsRest = src && src.restGrid ? src.restGrid.intRows || null : null; p.intRowsHeld = src && src.heldGrid ? src.heldGrid.intRows || null : null; }
  res.edgeClickLoss = res.phaseResults['edge-click-loss'] || null;
  rows.push(res);
  await writeFile(join(outDir, label + '.json'), JSON.stringify(res, null, 2) + '\n');
}
// compact matrix
const md = ['| run | frames | jumps (>=0.9px) | max |dx| Undo | max |dy| Undo | header heights | frame y | max overflow px | scrollbar px | hit-test losses (Undo/Redo frames) | effects ok / noops | failed phases |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of rows) {
  const failed = Object.entries(r.phases).filter(([, p]) => p.ok === false).map(([n]) => n).join(',') || '-';
  md.push(['`' + r.label + '`', r.frames, r.jumpCount, r.overall.undo.maxAbsDx, r.overall.undo.maxAbsDy, r.overall.headerHeights.join('/'), r.overall.frameY.join('/'), r.scroll.maxOverflowPx, r.scroll.scrollbarWidthPx.join('/'),
    r.hitTests.baselineUndoCentreNotUndoFrames + '/' + r.hitTests.baselineRedoCentreNotRedoFrames, r.actionSummary.enabledEffects + ' / ' + r.actionSummary.noOpsWithoutEffect + ' of ' + r.actionSummary.expectedNoOps, failed].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
}
await writeFile(join(outDir, 'matrix.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
