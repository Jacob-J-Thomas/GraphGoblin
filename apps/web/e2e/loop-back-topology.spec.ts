/**
 * #449 against the built app and an isolated in-memory API on an ephemeral port (global-setup):
 * the canvas finds loop-back connections from the graph, not from the Repeat switch, the route's
 * name or where the cards sit. GG_LOOPBACK_EVIDENCE_DIR writes the screenshots to that directory;
 * otherwise they stay in test-results.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { forwardLoopBack } from '../src/__fixtures__/routing.js';
import { defaultConfig } from '../src/editor/model.js';
import { closeNode, expect, openNode, test } from './fixtures.js';

const card = (id: string, kind: NodeInput['kind'], x: number, y = 100, config?: unknown) =>
  ({ id, label: id, kind, config: config ?? defaultConfig(kind), ui: { x, y } }) as NodeInput;
const link = (id: string, from: string, to: string, port = 'out') => ({
  id,
  from: { node: from, port },
  to: { node: to },
});

/**
 * Work, a script check and an unmarked decision, with two returns to `work`: the decision's
 * `retry` (Repeat off, no maximum passes) and the script's exit-code route `again`. A second
 * trigger, `side`, waits unconnected below: connected to `decide`, it bypasses `work`.
 */
function returns(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Unmarked returns',
    nodes: [
      card('start', 'trigger', 0),
      card('work', 'mutate', 300),
      card('check', 'script', 600, 100, { command: 'node', exitCodeRoutes: { '1': 'again' } }),
      card('decide', 'decision', 900, 100, {
        kind: 'expression',
        jsonata: '"done"',
        routes: [
          { id: 'retry', label: 'Retry' },
          { id: 'done', label: 'Done' },
        ],
      }),
      card('finish', 'exit', 1200, 100, {}),
      card('side', 'trigger', 600, 520),
    ],
    edges: [
      link('start-work', 'start', 'work'),
      link('work-check', 'work', 'check'),
      link('check-decide', 'check', 'decide'),
      link('retry', 'decide', 'work', 'retry'),
      link('again', 'check', 'work', 'again'),
      link('decide-finish', 'decide', 'finish', 'done'),
    ],
  };
}

async function openGraph(
  page: Page,
  request: APIRequestContext,
  definition: LoopDefinitionInput,
  theme: string,
) {
  await page.addInitScript((value) => {
    localStorage.setItem('graphgoblin-theme', value);
    localStorage.setItem('graphgoblin-palette', 'collapsed');
    localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
  }, theme);
  const response = await request.post('/loops', { data: { definition } });
  expect(response.status(), await response.text()).toBe(201);
  const { loop } = (await response.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.locator('.react-flow__node')).toHaveCount(definition.nodes.length);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.react-flow__edge-orthogonal title').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  return loop.id;
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const directory = process.env['GG_LOOPBACK_EVIDENCE_DIR'];
  const path = directory ? resolve(directory, `${name}.png`) : info.outputPath(`${name}.png`);
  if (directory) await mkdir(directory, { recursive: true });
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

/** The drawn path's stroke and animation, and the loop token resolved on this canvas. */
async function paint(target: Locator) {
  return target.evaluate((el) => {
    const path = el.querySelector('.react-flow__edge-path')!;
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.style.stroke = 'var(--canvas-edge-loop)';
    el.closest('svg')!.append(probe);
    const loop = getComputedStyle(probe).stroke;
    probe.remove();
    const style = getComputedStyle(path);
    return {
      stroke: style.stroke,
      animation: style.animationName,
      loop,
      d: path.getAttribute('d'),
    };
  });
}

async function expectLoopBack(page: Page, id: string, moving = true) {
  const target = edge(page, id);
  await expect(target).toHaveClass(/\bgg-edge-loop\b/);
  await expect(target).toHaveClass(/\banimated\b/);
  await expect(target).toHaveClass(/react-flow__edge-orthogonal/);
  await expect(target.locator('.react-flow__edge-path')).toHaveAttribute('d', /^M.*Q/);
  const drawn = await paint(target);
  expect(drawn.stroke, id).toBe(drawn.loop);
  expect(drawn.animation, id).toBe(moving ? 'dashdraw' : 'none');
}

async function expectOrdinary(page: Page, id: string) {
  const target = edge(page, id);
  await expect(target).toHaveCount(1);
  await expect(target).not.toHaveClass(/\bgg-edge-loop\b/);
  await expect(target).not.toHaveClass(/\banimated\b/);
  const drawn = await paint(target);
  expect(drawn.stroke, id).not.toBe(drawn.loop);
  expect(drawn.animation, id).toBe('none');
}

/** The stored draft once saved: the styling never writes a Repeat marker or limits. */
async function storedDecision(page: Page, request: APIRequestContext, loopId: string) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const saved = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: LoopDefinitionInput };
  };
  return saved.draft.definition;
}

for (const theme of ['dark', 'light']) {
  test(`${theme}: unmarked decision and script returns follow the graph through bypass, delete, undo, reload and reduced motion`, async ({
    page,
    request,
  }, info) => {
    const loopId = await openGraph(page, request, returns(), theme);
    const authored = (await (await request.get(`/loops/${loopId}`)).json()) as {
      draft: { definition: LoopDefinitionInput };
    };
    const gate = authored.draft.definition.nodes.find((n) => n.id === 'decide')!.config;
    for (const id of ['retry', 'again']) await expectLoopBack(page, id);
    for (const id of ['start-work', 'work-check', 'check-decide', 'decide-finish'])
      await expectOrdinary(page, id);
    await screenshot(page, info, `returns-${theme}`);

    // A bypass from the second trigger: `work` no longer precedes every path to `decide`.
    const dialog = await openNode(page, 'side');
    await dialog.getByLabel('Output', { exact: true }).selectOption('out');
    await dialog.getByLabel('To', { exact: true }).selectOption('decide');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await closeNode(page);
    const bypass = page.locator('.react-flow__edge[aria-label^="side out to decide"]');
    await expect(bypass).toHaveCount(1);
    await expectOrdinary(page, 'retry');
    // Still drawn leftward, so still routed backward, now in the ordinary style.
    await expect(edge(page, 'retry')).toHaveClass(/react-flow__edge-orthogonal/);
    await expect(edge(page, 'retry').locator('.react-flow__edge-path')).toHaveAttribute(
      'd',
      /^M.*Q/,
    );
    await expectLoopBack(page, 'again');
    await expectOrdinary(page, (await bypass.getAttribute('data-id'))!);
    await screenshot(page, info, `bypass-added-${theme}`);
    let stored = await storedDecision(page, request, loopId);
    expect(stored.edges.some((e) => e.from.node === 'side' && e.to.node === 'decide')).toBe(true);

    // Delete the bypass from the keyboard: the return is a loop-back again.
    await bypass.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Delete');
    await expect(bypass).toHaveCount(0);
    await expectLoopBack(page, 'retry');
    // Undo restores the bypass and the ordinary style; Redo removes both again.
    await page.keyboard.press('Control+z');
    await expect(bypass).toHaveCount(1);
    await expectOrdinary(page, 'retry');
    await page.keyboard.press('Control+y');
    await expect(bypass).toHaveCount(0);
    await expectLoopBack(page, 'retry');

    // Nothing the canvas derived was stored: Repeat stays off with no limits or Limit reached.
    stored = await storedDecision(page, request, loopId);
    const decide = stored.nodes.find((n) => n.id === 'decide')!;
    expect(decide.config).toEqual(gate);
    expect(JSON.stringify(decide.config)).not.toMatch(/"repeat"|"maxPasses"|limit-reached/);
    expect(stored.edges.some((e) => e.from.node === 'side')).toBe(false);
    expect(stored.edges.map((e) => e.id).sort()).toEqual(
      returns()
        .edges.map((e) => e.id)
        .sort(),
    );

    // A reload classifies the stored graph afresh.
    await page.reload();
    await expect(page.locator('.react-flow__edge-orthogonal title').first()).toBeAttached();
    for (const id of ['retry', 'again']) await expectLoopBack(page, id);
    await expectOrdinary(page, 'start-work');

    // Reduced motion stops the dash and keeps the loop colour.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const id of ['retry', 'again']) await expectLoopBack(page, id, false);
    await screenshot(page, info, `reduced-motion-${theme}`);
  });

  test(`${theme}: a return drawn rightward is a loop-back; a forward step drawn leftward is not`, async ({
    page,
    request,
  }, info) => {
    // routing.spec draws this graph with Repeat on; here the gate's Repeat switch is off.
    const definition = forwardLoopBack();
    definition.nodes.find((n) => n.id === 'done')!.config = {
      kind: 'expression',
      jsonata: '"repeat"',
      routes: [
        { id: 'repeat', label: 'Repeat' },
        { id: 'finish', label: 'Finish' },
      ],
    };
    await openGraph(page, request, definition, theme);
    await expectLoopBack(page, 'return');
    // Routed backward by the canvas direction, but the cycle's forward step: ordinary style.
    await expectOrdinary(page, 'work-done');
    await expect(edge(page, 'work-done')).toHaveClass(/react-flow__edge-orthogonal/);
    await expect(edge(page, 'work-done').locator('.react-flow__edge-path')).toHaveAttribute(
      'd',
      /^M.*Q/,
    );
    await expectOrdinary(page, 'begin');
    await expect(edge(page, 'begin')).not.toHaveClass(/react-flow__edge-orthogonal/);
    // The return is drawn pointing right: its source card ends left of its target card.
    const tips = await page.evaluate(() => {
      const box = (id: string) =>
        document.querySelector(`.react-flow__node[data-id="${id}"]`)!.getBoundingClientRect();
      return { done: box('done').right, work: box('work').left };
    });
    expect(tips.done).toBeLessThan(tips.work);
    await screenshot(page, info, `drawn-rightward-${theme}`);
  });
}
