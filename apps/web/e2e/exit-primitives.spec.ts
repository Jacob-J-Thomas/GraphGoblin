import {
  ClassifierModelSummarySchema,
  ExitPredicateSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  type ExitConfig,
  type ExitPredicate,
  type LoopDefinition,
  type LoopDefinitionInput,
  type RunEvent,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { closeNode, control, expect, openItem, openNode, test } from './fixtures.js';

const LOCAL_MODEL = 'exit-local';
const CHOICE_MODEL = 'exit-choice-only';

type ClassifierReply =
  | { type: 'noul'; trueProbability: number }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> };

type Synthetic = {
  url: string;
  classifier: {
    endpoint: string;
    replies: (replies: ClassifierReply[]) => Promise<void>;
    requests: () => Promise<{ model: string; type: 'choice' | 'noul' | 'score' }[]>;
  };
};

async function startControlledClassifier(request: APIRequestContext) {
  const started = await control(request, '/classifier/start');
  const endpoint = z.string().parse(started['endpoint']);
  expect(new URL(endpoint).hostname).toBe('127.0.0.1');
  return {
    endpoint,
    async replies(replies: ClassifierReply[]) {
      const result = await control(request, '/classifier/replies', { endpoint, replies });
      expect(result['configured']).toBe(true);
      expect(result['queued']).toBe(replies.length);
    },
    async requests() {
      const result = await control(request, '/classifier/requests', { endpoint });
      return z
        .object({
          model: z.string(),
          type: z.enum(['choice', 'noul', 'score']),
        })
        .array()
        .parse(result['requests']);
    },
    async close() {
      const result = await control(request, '/classifier/stop', { endpoint });
      expect(result['closed']).toBe(true);
    },
  };
}

/** Each test has its own memory-only API and loopback HTTP fake; no native provider is selectable. */
const exitTest = test.extend<{ synthetic: Synthetic }>({
  synthetic: async ({ request }, use) => {
    const classifier = await startControlledClassifier(request);
    try {
      const app = await control(request, '/apps', { realClassifiers: true });
      const url = String(app['url']);
      const catalog = await classifierCatalog(request, url);
      expect(catalog.some((model) => model.id === 'jev')).toBe(true);
      for (const model of catalog) {
        const disabled = await request.patch(url + '/classifier-models/' + model.id, {
          data: { enabled: false },
        });
        expect(disabled.status()).toBe(200);
      }
      await registerLocalClassifier(request, url, classifier.endpoint, LOCAL_MODEL, [
        'choice',
        'noul',
        'score',
      ]);
      const isolated = await classifierCatalog(request, url);
      expect(isolated.filter((model) => model.enabled).map((model) => model.id)).toEqual([
        LOCAL_MODEL,
      ]);
      expect(isolated.find((model) => model.id === 'jev')?.enabled).toBe(false);
      await use({ url, classifier });
    } finally {
      await classifier.close();
    }
  },
});

// A failed acceptance must remain available for diagnosis, including in CI.
exitTest.describe.configure({ retries: 0 });

async function classifierCatalog(request: APIRequestContext, url: string) {
  const response = await request.get(url + '/classifier-models');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: unknown };
  return ClassifierModelSummarySchema.array().parse(body.items);
}

async function registerLocalClassifier(
  request: APIRequestContext,
  url: string,
  endpoint: string,
  id: string,
  primitives: ('choice' | 'noul' | 'score')[],
) {
  expect(new URL(endpoint).hostname).toBe('127.0.0.1');
  const created = await request.put(url + '/classifier-models/' + id, {
    data: {
      provider: 'http',
      providerModel: id,
      displayName: id === CHOICE_MODEL ? 'Local Choice Only' : 'Local Exit Primitives',
      endpoint,
      primitives,
    },
  });
  expect(created.status()).toBe(200);
  expect(
    (await request.patch(url + '/classifier-models/' + id, { data: { enabled: true } })).status(),
  ).toBe(200);
}

function expression(jsonata: string, value = true): ExitPredicate {
  return ExitPredicateSchema.parse({
    when: 'predicate',
    answer: { type: 'noul' },
    evaluation: { kind: 'expression', jsonata },
    match: { type: 'noul', value },
    outcome: 'success',
  });
}

function noul(minConfidence: number): ExitPredicate {
  return ExitPredicateSchema.parse({
    when: 'predicate',
    answer: {
      type: 'noul',
      true: { label: 'Ready', criteria: 'Every synthetic check passes' },
      false: { label: 'Continue', criteria: 'A synthetic check is still incomplete' },
    },
    evaluation: {
      kind: 'classifier',
      model: LOCAL_MODEL,
      question: 'Is the synthetic result ready?',
      minConfidence,
    },
    match: { type: 'noul', value: false },
    outcome: 'success',
  });
}

function score(): ExitPredicate {
  return ExitPredicateSchema.parse({
    when: 'predicate',
    answer: { type: 'score', anchors: ['Low', 'Moderate', 'High'] },
    evaluation: {
      kind: 'classifier',
      model: LOCAL_MODEL,
      question: 'Score the synthetic result.',
      minConfidence: 0.8,
    },
    match: { type: 'score', operator: 'gte', value: 1.5 },
    outcome: 'success',
  });
}

function exitLoop(
  name: string,
  criteria: ExitConfig['criteria'],
  maxIterations = 1,
): LoopDefinitionInput {
  return {
    schemaVersion: 3,
    name,
    settings: { maxIterations },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'prepare',
        kind: 'mutate',
        label: 'Prepare',
        config: {
          operations: [
            { op: 'set', path: '/vars/synthetic', value: { kind: 'literal', value: true } },
          ],
        },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'alternate',
        kind: 'mutate',
        label: 'Alternate',
        config: {
          operations: [{ op: 'append-message', role: 'assistant', content: 'Alternate ran' }],
        },
        ui: { x: 260, y: 260 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          criteria,
          default: 'loop-back',
          loopBack: { targetNodeId: 'prepare' },
          return: { mapping: '{ "synthetic": vars.synthetic }', channels: [{ kind: 'caller' }] },
        },
        ui: { x: 540, y: 80 },
      },
    ],
    edges: [
      { id: 'start-prepare', from: { node: 'start', port: 'out' }, to: { node: 'prepare' } },
      { id: 'prepare-done', from: { node: 'prepare', port: 'out' }, to: { node: 'done' } },
      { id: 'alternate-done', from: { node: 'alternate', port: 'out' }, to: { node: 'done' } },
      { id: 'exit-loopback', from: { node: 'done', port: 'loopBack' }, to: { node: 'prepare' } },
    ],
  };
}

function exitConfig(definition: LoopDefinition): ExitConfig {
  const node = definition.nodes.find((item) => item.id === 'done');
  if (node?.kind !== 'exit') throw new Error('Saved exit node is missing.');
  return node.config;
}

function assertLocalModels(definition: LoopDefinition | LoopDefinitionInput) {
  const node = definition.nodes.find((item) => item.id === 'done');
  if (node?.kind !== 'exit') throw new Error('Exit fixture is missing.');
  for (const criterion of node.config.criteria ?? []) {
    if (criterion.when === 'predicate' && criterion.evaluation.kind === 'classifier') {
      expect([LOCAL_MODEL, CHOICE_MODEL]).toContain(criterion.evaluation.model);
    }
  }
}

async function openEditor(page: Page, url: string, loopId: string) {
  await page.goto(url + '/app/loops/' + loopId + '/edit');
  await expect(page.getByTestId('node-done')).toBeVisible();
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: 'Fit view' }).click();
  await page.evaluate(() => document.fonts.ready);
}

async function createLoop(
  page: Page,
  request: APIRequestContext,
  url: string,
  definition: LoopDefinitionInput,
) {
  assertLocalModels(definition);
  const response = await request.post(url + '/loops', { data: { definition } });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { loop: { id: string } };
  await openEditor(page, url, body.loop.id);
  return body.loop.id;
}

async function savedDraft(page: Page, request: APIRequestContext, url: string, loopId: string) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const response = await request.get(url + '/loops/' + loopId);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { draft: { definition: unknown } };
  const definition = LoopDefinitionSchema.parse(body.draft.definition);
  assertLocalModels(definition);
  return definition;
}

async function criterionEditor(page: Page, index = 0): Promise<Locator> {
  const dialog = await openNode(page, 'done');
  await expect(dialog).toHaveAccessibleName('Edit exit done');
  await openItem(dialog, 'Criteria ' + (index + 1));
  return dialog;
}

async function chooseAnswer(page: Page, dialog: Locator, type: 'Choice' | 'Noul' | 'Score') {
  const radio = dialog.getByRole('radiogroup', { name: 'Answer type' }).getByRole('radio', {
    name: type,
    exact: true,
  });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
}

async function assertOnlyLoopBack(page: Page) {
  const outputs = page.locator('.react-flow__handle[data-nodeid="done"]:not([data-handleid="in"])');
  await expect(outputs).toHaveCount(1);
  await expect(outputs).toHaveAttribute('data-handleid', 'loopBack');
}

async function publish(page: Page, version: number) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version ' + version + '.')).toBeVisible();
}

async function runLoop(
  page: Page,
  request: APIRequestContext,
  url: string,
  loopId: string,
  status: 'succeeded' | 'exhausted',
): Promise<RunEvent[]> {
  await page.goto(url + '/app/runs/new?loop=' + loopId);
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  await expect(page.locator('[data-status="' + status + '"]').first()).toBeVisible();
  const runId = page.url().split('/').at(-1);
  const response = await request.get(url + '/runs/' + runId + '/events');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: unknown };
  const events = RunEventSchema.array().parse(body.items);
  const finishedExits = events
    .filter((event) => event.type === 'node.finished')
    .filter((event) => event.nodeId === 'done');
  expect(finishedExits).toHaveLength(exitEvaluations(events).length);
  expect(finishedExits.every((event) => event.patch.length === 0)).toBe(true);
  expect(events.some((event) => event.type === 'decision.made')).toBe(false);
  return events;
}

function exitEvaluations(events: RunEvent[]) {
  return events.filter((event) => event.type === 'exit.evaluated');
}

async function inspectLastExit(page: Page) {
  await page
    .getByRole('list', { name: 'Timeline' })
    .getByRole('button', { name: /exit\.evaluated/ })
    .last()
    .click();
  await expect(page.getByRole('heading', { name: 'Evaluation details' })).toBeVisible();
  return page.getByRole('list', { name: 'Exit criteria' });
}

exitTest(
  'expression Noul false matches false after authoring, saving, reloading, publishing and running',
  async ({ page, request, synthetic }) => {
    const { url, classifier } = synthetic;
    const loopId = await createLoop(
      page,
      request,
      url,
      exitLoop('Exit expression false', [expression('true')]),
    );
    let dialog = await criterionEditor(page);
    await expect(dialog.getByRole('radio', { name: 'Noul', exact: true })).toBeChecked();
    await dialog
      .locator('[data-field="criteria.0.evaluation.jsonata"] [role="textbox"]')
      .fill('false');
    await dialog.getByRole('switch', { name: 'Match when the answer is true' }).click();
    await expect(
      dialog.getByRole('switch', { name: 'Match when the answer is true' }),
    ).not.toBeChecked();
    await closeNode(page);
    const saved = await savedDraft(page, request, url, loopId);
    expect(exitConfig(saved).criteria).toEqual([expression('false', false)]);
    await assertOnlyLoopBack(page);
    await page.reload();
    dialog = await criterionEditor(page);
    await expect(
      dialog.locator('[data-field="criteria.0.evaluation.jsonata"] [role="textbox"]'),
    ).toHaveText('false');
    await expect(
      dialog.getByRole('switch', { name: 'Match when the answer is true' }),
    ).not.toBeChecked();
    await closeNode(page);
    await publish(page, 1);
    const events = await runLoop(page, request, url, loopId, 'succeeded');
    expect(exitEvaluations(events)).toEqual([
      expect.objectContaining({
        iteration: 1,
        maxIterations: 1,
        result: {
          kind: 'completed',
          outcome: 'success',
          reason: 'criterion-matched',
          criterionIndex: 0,
        },
        criteria: [
          expect.objectContaining({
            status: 'matched',
            strategy: 'expression',
            answer: { type: 'noul', kind: 'expression', holds: false, confidence: null },
            match: { type: 'noul', value: false },
            acceptance: { status: 'accepted' },
          }),
        ],
      }),
    ]);
    expect(events.some((event) => event.type === 'iteration.incremented')).toBe(false);
    expect(
      events.some((event) => event.type === 'return.delivered' && event.channel.kind === 'caller'),
    ).toBe(true);
    const details = await inspectLastExit(page);
    await expect(details).toContainText('Noul false');
    await expect(details).toContainText('Noul is false');
    await expect(details).toContainText('Accepted');
    expect(await classifier.requests()).toHaveLength(0);
  },
);

exitTest(
  'Choice matches stable IDs, then a primitive switch requires a Score-capable local classifier',
  async ({ page, request, synthetic }) => {
    const { url, classifier } = synthetic;
    await registerLocalClassifier(request, url, classifier.endpoint, CHOICE_MODEL, ['choice']);
    const predicate = ExitPredicateSchema.parse({
      when: 'predicate',
      answer: {
        type: 'choice',
        options: [
          { id: 'ready', label: 'Ready', criteria: 'Ready to exit' },
          { id: 'continue', label: 'Continue', criteria: 'Continue checking' },
        ],
      },
      evaluation: {
        kind: 'classifier',
        model: CHOICE_MODEL,
        question: 'Choose the synthetic status.',
      },
      match: { type: 'choice', optionIds: ['continue'] },
      outcome: 'success',
    });
    const loopId = await createLoop(page, request, url, exitLoop('Exit Choice IDs', [predicate]));
    let dialog = await criterionEditor(page);
    await dialog.locator('[data-field="criteria.0.answer.options.0.label"] input').fill('Reviewed');
    const ready = dialog.getByRole('checkbox', { name: /Reviewed.*ready/ });
    const continuing = dialog.getByRole('checkbox', { name: /Continue.*continue/ });
    await ready.focus();
    await page.keyboard.press('Space');
    await continuing.focus();
    await page.keyboard.press('Space');
    await expect(ready).toBeChecked();
    await expect(continuing).not.toBeChecked();
    await closeNode(page);
    const choiceSaved = exitConfig(await savedDraft(page, request, url, loopId)).criteria[0];
    expect(choiceSaved).toMatchObject({
      answer: { type: 'choice', options: [{ id: 'ready', label: 'Reviewed' }, { id: 'continue' }] },
      evaluation: { model: CHOICE_MODEL },
      match: { type: 'choice', optionIds: ['ready'] },
    });
    await page.reload();
    dialog = await criterionEditor(page);
    await expect(dialog.getByRole('checkbox', { name: /Reviewed.*ready/ })).toBeChecked();
    await expect(dialog.getByLabel('Classifier', { exact: true })).toHaveValue(CHOICE_MODEL);
    await closeNode(page);
    await publish(page, 1);
    const events = await runLoop(page, request, url, loopId, 'succeeded');
    expect(exitEvaluations(events)[0]?.criteria[0]).toMatchObject({
      status: 'matched',
      answer: { type: 'choice', optionId: 'ready' },
      match: { type: 'choice', optionIds: ['ready'] },
      provenance: { classifierId: CHOICE_MODEL },
    });
    expect(await classifier.requests()).toHaveLength(1);
    expect((await classifier.requests())[0]?.model).toBe(CHOICE_MODEL);
    expect((await classifier.requests())[0]?.type).toBe('choice');

    await openEditor(page, url, loopId);
    dialog = await criterionEditor(page);
    await chooseAnswer(page, dialog, 'Score');
    const picker = dialog.getByLabel('Classifier', { exact: true });
    await expect(picker).toHaveValue(CHOICE_MODEL);
    await expect(picker.getByRole('option', { selected: true })).toContainText('not Score-capable');
    await expect(dialog).toContainText('Choose a Score-capable classifier');
    await expect(picker.locator('option[value="jev"]')).toHaveCount(0);
    await picker.selectOption(LOCAL_MODEL);
    await dialog.getByLabel('Score comparison', { exact: true }).selectOption('gte');
    await dialog.getByLabel('Rubric index', { exact: true }).fill('1.25');
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria[0]).toMatchObject({
      answer: { type: 'score' },
      evaluation: { kind: 'classifier', model: LOCAL_MODEL },
      match: { type: 'score', operator: 'gte', value: 1.25 },
    });
    await page.reload();
    dialog = await criterionEditor(page);
    await expect(dialog.getByRole('radio', { name: 'Score', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Classifier', { exact: true })).toHaveValue(LOCAL_MODEL);
    await expect(dialog.getByLabel('Rubric index', { exact: true })).toHaveValue('1.25');
    await expect(dialog.getByRole('radio', { name: 'Codex LLM', exact: true })).toHaveCount(0);
    await closeNode(page);
    await assertOnlyLoopBack(page);
  },
);

exitTest(
  'fractional Score keeps exact comparison and separates accepted nonmatch from confidence rejection',
  async ({ page, request, synthetic }) => {
    const { url, classifier } = synthetic;
    await classifier.replies([
      {
        type: 'score',
        score: 1.25,
        confidence: 0.9,
        probabilities: { '0': 0.2, '1': 0.6, '2': 0.2 },
      },
      {
        type: 'score',
        score: 1.25,
        confidence: 0.6,
        probabilities: { '0': 0.2, '1': 0.6, '2': 0.2 },
      },
      {
        type: 'score',
        score: 1.25,
        confidence: 0.6,
        probabilities: { '0': 0.2, '1': 0.6, '2': 0.2 },
      },
    ]);
    const loopId = await createLoop(
      page,
      request,
      url,
      exitLoop('Exit fractional Score', [score()]),
    );
    let dialog = await criterionEditor(page);
    await dialog.getByLabel('Score comparison', { exact: true }).selectOption('eq');
    await dialog.getByLabel('Rubric index', { exact: true }).fill('1.2');
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria[0]).toMatchObject({
      evaluation: { model: LOCAL_MODEL, minConfidence: 0.8 },
      match: { type: 'score', operator: 'eq', value: 1.2 },
    });
    await page.reload();
    dialog = await criterionEditor(page);
    await expect(dialog.getByLabel('Score comparison', { exact: true })).toHaveValue('eq');
    await expect(dialog.getByLabel('Rubric index', { exact: true })).toHaveValue('1.2');
    await closeNode(page);
    await publish(page, 1);
    const nonmatching = await runLoop(page, request, url, loopId, 'exhausted');
    expect(exitEvaluations(nonmatching)[0]?.criteria[0]).toMatchObject({
      status: 'not-matched',
      answer: { type: 'score', score: 1.25, confidence: 0.9 },
      acceptance: { status: 'accepted' },
      match: { type: 'score', operator: 'eq', value: 1.2 },
    });
    expect(exitEvaluations(nonmatching)[0]?.criteria[0]).not.toHaveProperty('rejection');
    let details = await inspectLastExit(page);
    await expect(details).toContainText('Score 1.25');
    await expect(details).toContainText('Score = 1.2');
    await expect(details).toContainText('Accepted');
    await expect(
      details.getByRole('list', { name: 'Criterion 1 rubric index probabilities' }),
    ).toContainText('1: 0.6');

    const rejected = await runLoop(page, request, url, loopId, 'exhausted');
    expect(exitEvaluations(rejected)[0]?.criteria[0]).toMatchObject({
      status: 'not-matched',
      answer: { type: 'score', score: 1.25, confidence: 0.6 },
      acceptance: { status: 'rejected', code: 'EVALUATION_RESULT_REJECTED', minConfidence: 0.8 },
      rejection: { kind: 'classifier-confidence', minimum: 0.8, confidence: 0.6 },
    });
    details = await inspectLastExit(page);
    await expect(details).toContainText('Score 1.25');
    await expect(details).toContainText('Rejected at classifier confidence 0.8');
    await expect(details).toContainText('treated as a nonmatch');

    await openEditor(page, url, loopId);
    dialog = await criterionEditor(page);
    await dialog.getByLabel('Score comparison', { exact: true }).selectOption('gte');
    await dialog.getByLabel('Rubric index', { exact: true }).fill('1.25');
    await dialog.getByLabel('Minimum classifier confidence', { exact: true }).fill('0.6');
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria[0]).toMatchObject({
      evaluation: { model: LOCAL_MODEL, minConfidence: 0.6 },
      match: { type: 'score', operator: 'gte', value: 1.25 },
    });
    await publish(page, 2);
    const matched = await runLoop(page, request, url, loopId, 'succeeded');
    expect(exitEvaluations(matched)[0]).toMatchObject({
      iteration: 1,
      maxIterations: 1,
      result: { kind: 'completed', reason: 'criterion-matched', criterionIndex: 0 },
      criteria: [
        { status: 'matched', answer: { score: 1.25 }, acceptance: { status: 'accepted' } },
      ],
    });
    expect(await classifier.requests()).toHaveLength(3);
    expect((await classifier.requests()).every((call) => call.model === LOCAL_MODEL)).toBe(true);
  },
);

exitTest(
  'ordered criteria removal and loopback reconnect undo restore the exact saved contract without answer ports',
  async ({ page, request, synthetic }) => {
    const { url, classifier } = synthetic;
    const loopId = await createLoop(
      page,
      request,
      url,
      exitLoop('Exit order and undo', [
        expression('false'),
        expression('true'),
        expression('true'),
      ]),
    );
    const before = await savedDraft(page, request, url, loopId);
    let dialog = await criterionEditor(page);
    await dialog.getByRole('button', { name: 'Remove criteria 1', exact: true }).click();
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria).toEqual(
      exitConfig(before).criteria.slice(1),
    );
    await page.getByRole('button', { name: /^Undo / }).click();
    expect(exitConfig(await savedDraft(page, request, url, loopId))).toEqual(exitConfig(before));

    dialog = await criterionEditor(page);
    const connections = dialog.getByRole('region', { name: 'Connections' });
    await connections
      .getByRole('button', { name: 'Remove edge exit-loopback', exact: true })
      .click();
    await expect(connections).toContainText('No outgoing edges.');
    await dialog.getByLabel('Output', { exact: true }).selectOption('loopBack');
    await dialog.getByLabel('To', { exact: true }).selectOption('alternate');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(connections).toContainText('alternate');
    await closeNode(page);
    const reconnected = await savedDraft(page, request, url, loopId);
    expect(exitConfig(reconnected).loopBack).toEqual({ targetNodeId: 'alternate' });
    expect(reconnected.edges.find((item) => item.from.node === 'done')).toMatchObject({
      from: { node: 'done', port: 'loopBack' },
      to: { node: 'alternate' },
    });
    await page.getByRole('button', { name: /^Undo / }).click();
    await page.getByRole('button', { name: /^Undo / }).click();
    const undone = await savedDraft(page, request, url, loopId);
    expect(exitConfig(undone)).toEqual(exitConfig(before));
    expect(undone.edges).toEqual(before.edges);
    await assertOnlyLoopBack(page);
    await page.reload();
    const reloaded = await savedDraft(page, request, url, loopId);
    expect(exitConfig(reloaded)).toEqual(exitConfig(before));
    expect(reloaded.edges).toEqual(before.edges);
    await publish(page, 1);
    const events = await runLoop(page, request, url, loopId, 'succeeded');
    expect(exitEvaluations(events)[0]).toMatchObject({
      result: { kind: 'completed', reason: 'criterion-matched', criterionIndex: 1 },
      criteria: [
        { index: 0, status: 'not-matched', answer: { holds: false } },
        { index: 1, status: 'matched', answer: { holds: true } },
        { index: 2, status: 'skipped' },
      ],
    });
    const details = await inspectLastExit(page);
    await expect(details.getByRole('listitem').nth(0)).toContainText('did not match');
    await expect(details.getByRole('listitem').nth(1)).toContainText('matched');
    await expect(details.getByRole('listitem').nth(2)).toContainText('skipped');
    expect(await classifier.requests()).toHaveLength(0);
  },
);

exitTest(
  'rejected classifier false remains a nonmatch; equality at the confidence minimum can match on the final iteration',
  async ({ page, request, synthetic }) => {
    const { url, classifier } = synthetic;
    // First run rejects both false answers. In the second run an accepted true does
    // not match false; the final false has confidence exactly at the authored gate.
    await classifier.replies([
      { type: 'noul', trueProbability: 0.25 },
      { type: 'noul', trueProbability: 0.25 },
      { type: 'noul', trueProbability: 0.875 },
      { type: 'noul', trueProbability: 0.125 },
    ]);
    const loopId = await createLoop(
      page,
      request,
      url,
      exitLoop('Exit false confidence gate', [noul(0.8)], 2),
    );
    let dialog = await criterionEditor(page);
    await expect(
      dialog.getByRole('switch', { name: 'Match when the answer is true' }),
    ).not.toBeChecked();
    await dialog
      .getByLabel('Question', { exact: true })
      .fill('Is the synthetic final result ready?');
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria[0]).toMatchObject({
      evaluation: {
        model: LOCAL_MODEL,
        minConfidence: 0.8,
        question: 'Is the synthetic final result ready?',
      },
      match: { type: 'noul', value: false },
    });
    await page.reload();
    dialog = await criterionEditor(page);
    await expect(dialog.getByLabel('Classifier', { exact: true })).toHaveValue(LOCAL_MODEL);
    await expect(
      dialog.getByRole('switch', { name: 'Match when the answer is true' }),
    ).not.toBeChecked();
    await closeNode(page);
    await publish(page, 1);
    const rejected = await runLoop(page, request, url, loopId, 'exhausted');
    expect(exitEvaluations(rejected)).toHaveLength(2);
    for (const event of exitEvaluations(rejected)) {
      expect(event.criteria[0]).toMatchObject({
        status: 'not-matched',
        answer: { type: 'noul', holds: false, trueProbability: 0.25, confidence: 0.75 },
        match: { type: 'noul', value: false },
        acceptance: { status: 'rejected', minConfidence: 0.8 },
        rejection: { kind: 'classifier-confidence', minimum: 0.8, confidence: 0.75 },
      });
    }
    expect(rejected.filter((event) => event.type === 'iteration.incremented')).toHaveLength(1);
    expect(exitEvaluations(rejected).at(-1)?.result).toMatchObject({
      kind: 'limit-reached',
      limit: 'iteration-ceiling',
      value: 2,
    });
    let details = await inspectLastExit(page);
    await expect(details).toContainText('Noul false');
    await expect(details).toContainText('Noul is false');
    await expect(details).toContainText('did not match');
    await expect(details).toContainText('treated as a nonmatch');

    await openEditor(page, url, loopId);
    dialog = await criterionEditor(page);
    await dialog.getByLabel('Minimum classifier confidence', { exact: true }).fill('0.875');
    await closeNode(page);
    expect(exitConfig(await savedDraft(page, request, url, loopId)).criteria[0]).toMatchObject({
      evaluation: { model: LOCAL_MODEL, minConfidence: 0.875 },
      match: { type: 'noul', value: false },
    });
    await publish(page, 2);
    const matched = await runLoop(page, request, url, loopId, 'succeeded');
    expect(exitEvaluations(matched)).toHaveLength(2);
    expect(exitEvaluations(matched)[0]).toMatchObject({
      iteration: 1,
      result: { kind: 'looped-back' },
      criteria: [
        { status: 'not-matched', answer: { holds: true }, acceptance: { status: 'accepted' } },
      ],
    });
    expect(exitEvaluations(matched)[1]).toMatchObject({
      iteration: 2,
      maxIterations: 2,
      result: {
        kind: 'completed',
        outcome: 'success',
        criterionIndex: 0,
        reason: 'criterion-matched',
      },
      criteria: [
        {
          status: 'matched',
          answer: { holds: false, trueProbability: 0.125, confidence: 0.875 },
          acceptance: { status: 'accepted' },
        },
      ],
    });
    expect(matched.filter((event) => event.type === 'iteration.incremented')).toEqual([
      expect.objectContaining({ from: 1, to: 2, targetNodeId: 'prepare' }),
    ]);
    expect(await classifier.requests()).toHaveLength(4);
    expect((await classifier.requests()).every((call) => call.model === LOCAL_MODEL)).toBe(true);
    details = await inspectLastExit(page);
    await expect(details).toContainText('Noul false');
    await expect(details).toContainText('Accepted');
  },
);
