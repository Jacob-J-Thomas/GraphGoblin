import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  initializeBrowserProbe,
  readBrowserProbe,
  afterBrowserPaint,
  timelineHistoryReady,
} from './browser.mjs';

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { JSDOM } = await import(requireWeb.resolve('jsdom'));
const pages = [];
function documentPage(html = '') {
  const page = new JSDOM(html, { url: 'https://measurement.fixture' });
  pages.push(page);
  vi.stubGlobal('window', page.window);
  vi.stubGlobal('document', page.window.document);
  vi.stubGlobal('sessionStorage', page.window.sessionStorage);
  return page.window;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const page of pages.splice(0)) page.window.close();
});

test('long-task initialization observes buffered tasks and retains only timing observations', () => {
  const page = documentPage();
  vi.stubGlobal('performance', { now: () => 42 });
  let receive;
  const observe = vi.fn();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(callback) {
        receive = callback;
      }
      observe = observe;
    },
  );
  initializeBrowserProbe();
  assert.deepEqual(page.__perf, { longTasks: [], started: 42 });
  assert.deepEqual(observe.mock.calls, [[{ type: 'longtask', buffered: true }]]);
  receive({
    getEntries: () => [
      { startTime: 50, duration: 75, name: 'irrelevant task details' },
      { startTime: 150, duration: 100 },
    ],
  });
  assert.deepEqual(page.__perf.longTasks, [
    { start: 50, duration: 75 },
    { start: 150, duration: 100 },
  ]);
});

test('browser metrics measure a rendered timeline, UTF-16 storage and available heap', () => {
  const page = documentPage(
    '<h1>Inspector</h1><h2>Timeline (99 events)</h2><ol aria-label="Timeline"><li><button data-seq="99"><span>#99</span></button></li></ol>',
  );
  page.__perf = { longTasks: [{ start: 10, duration: 60 }] };
  page.sessionStorage.setItem('unicode', '💡測定');
  vi.stubGlobal('performance', { memory: { usedJSHeapSize: 123, totalJSHeapSize: 456 } });
  assert.deepEqual(readBrowserProbe(), {
    entries: [{ start: 10, duration: 60 }],
    nodes: 9,
    timelineItems: 1,
    timelineNodes: 3,
    sessionStorageBytes: 8,
    heap: { used: 123, total: 456 },
  });
});

test('empty-page browser metrics keep missing timeline and unavailable heap explicit', () => {
  const page = documentPage();
  page.__perf = { longTasks: [] };
  vi.stubGlobal('performance', {});
  assert.deepEqual(readBrowserProbe(), {
    entries: [],
    nodes: 3,
    timelineItems: 0,
    timelineNodes: 0,
    sessionStorageBytes: 0,
    heap: null,
  });
});

test('shell observation waits for two animation frames before it can resolve', async () => {
  const frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.push(callback);
  });
  let ready = false;
  const painted = afterBrowserPaint().then(() => {
    ready = true;
  });
  assert.equal(frames.length, 1);
  frames.shift()();
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(frames.length, 1);
  frames.shift()();
  await painted;
  assert.equal(ready, true);
});

test.each([
  {
    name: 'reported count cannot hide a stale rendered tail',
    target: 100,
    ready: false,
    html: '<h2>Timeline (200 events)</h2><ol aria-label="Timeline"><li><button data-seq="99">#99</button></li></ol>',
  },
  {
    name: 'a virtualized tail can acknowledge the loaded history',
    target: 100,
    ready: true,
    html: '<h1>Inspector</h1><h2>Timeline (100 events)</h2><ol aria-label="Timeline"><li><button data-seq="100">#100</button></li></ol>',
  },
  {
    name: 'the previous span cursor remains readable',
    target: 100,
    ready: true,
    html: '<h2>Timeline (100 events)</h2><ol aria-label="Timeline"><li><button><span>#100</span></button></li></ol>',
  },
  {
    name: 'a malformed explicit cursor cannot borrow a span cursor',
    target: 100,
    ready: false,
    html: '<h2>Timeline (100 events)</h2><ol aria-label="Timeline"><li><button data-seq="invalid"><span>#100</span></button></li></ol>',
  },
  {
    name: 'a missing cursor cannot acknowledge reported history',
    target: 100,
    ready: false,
    html: '<h2>Timeline (100 events)</h2><ol aria-label="Timeline"><li><button>loading</button></li></ol>',
  },
  {
    name: 'an absent timeline cannot acknowledge history',
    target: 100,
    ready: false,
    html: '<h2>Timeline (100 events)</h2>',
  },
  {
    name: 'a fully rendered short timeline needs no count heading',
    target: 2,
    ready: true,
    html: '<h1>Inspector</h1><ol aria-label="Timeline"><li><button data-seq="1">#1</button></li><li><button data-seq="2">#2</button></li></ol>',
  },
])('history readiness: $name', ({ html, target, ready }) => {
  documentPage(html);
  assert.equal(timelineHistoryReady(target), ready);
});
