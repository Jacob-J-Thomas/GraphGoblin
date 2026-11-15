// Independent audit probe: public ReactFlow setViewport before any awaited continuation.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const local = createRequire(path.join(root, 'apps/web/package.json'));
const { JSDOM } = local('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 600; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'checkVisibility', { configurable: true, value() { return true; } });
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { queueMicrotask(() => this.callback([{ target, contentRect: { width: 800, height: 600 } }], this)); }
  unobserve() {}
  disconnect() {}
};
const React = local('react');
const { render, waitFor, cleanup } = local('@testing-library/react');
const { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi } = local('@xyflow/react');
let flow;
let flowStore;
function Observe() { flow = useReactFlow(); flowStore = useStoreApi(); return null; }
const samples = [];
let stop;
(async () => {
  try {
    render(React.createElement(ReactFlowProvider, null,
      React.createElement(ReactFlow, { nodes: [], edges: [], minZoom: 0.1, maxZoom: 2 }),
      React.createElement(Observe)));
    await waitFor(() => assert.equal(flow.viewportInitialized, true));
    const transforms = [];
    stop = flowStore.subscribe((state, prior) => {
      if (state.transform !== prior.transform) transforms.push([...state.transform]);
    });
    for (const wanted of [{ x: 72, y: 303.5, zoom: 1.57895 }, { x: -57.25, y: 19, zoom: 0.5 }, { x: 0, y: 0, zoom: 2 }]) {
      const before = transforms.length;
      let settled = false;
      const promise = flow.setViewport(wanted);
      void promise.then(() => { settled = true; });
      const immediate = flow.getViewport();
      assert.deepEqual(immediate, wanted);
      assert.equal(transforms.length, before + 1);
      assert.equal(settled, false);
      samples.push({ wanted, immediate, transformCountBeforeAwait: transforms.length - before, promiseSettledBeforeAwait: settled });
      assert.equal(await promise, true);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.deepEqual(flow.getViewport(), wanted);
      assert.equal(transforms.length, before + 1);
    }
    const result = { result: 'PASS', node: process.version, boundary: 'real installed ReactFlow public API in jsdom; synthetic layout; no Canvas, browser painting, input, source mutation, or private store writes', samples };
    writeFileSync(path.join(__dirname, 'synchronous-public-probe.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { stop?.(); cleanup(); dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
