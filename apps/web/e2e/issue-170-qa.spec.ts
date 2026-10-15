/** Independent browser QA for #170. Defect references resolve in docs/qa/2026-10-10-issue-170. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  DecisionConfigSchema,
  InferenceConfigSchema,
  LoopDefinitionSchema,
  type LoopDefinition,
  type ClassifierAnswerConfig,
} from '@graphgoblin/contracts';
import { everyFieldLoop } from '@graphgoblin/contracts/testing';
import {
  approvalLoop,
  closeNode,
  control,
  expect,
  openAdvanced,
  openNode,
  test,
} from './fixtures.js';

const baselineCommit = '6976aa90f9c04bdef04b75ba14d297f58cdee8ba';
let baselineDir: string | undefined;
let baseline: {
  InferenceConfigSchema: typeof InferenceConfigSchema;
};
test.beforeAll(async () => {
  // A read-only main-schema oracle: transpile tracked sources into this test's private temp
  // directory, resolving the already-installed zod directly. No checkout, install or link.
  baselineDir = await mkdtemp(join(tmpdir(), 'gg170-main-contracts-'));
  await writeFile(join(baselineDir, 'package.json'), '{"type":"module"}');
  const require = createRequire(import.meta.url);
  const zodUrl = pathToFileURL(join(dirname(require.resolve('zod/package.json')), 'index.js')).href;
  const prefix = 'packages/contracts/src/';
  const paths = execFileSync(
    'git',
    ['ls-tree', '-r', '--full-tree', '--name-only', baselineCommit, prefix],
    {
      encoding: 'utf8',
    },
  )
    .trim()
    .split('\n');
  for (const path of paths.filter(
    (p) => !p.endsWith('.test.ts') && (p.endsWith('.ts') || p.endsWith('.json')),
  )) {
    const target = join(baselineDir, path.slice(prefix.length).replace(/\.ts$/, '.js'));
    await mkdir(dirname(target), { recursive: true });
    const source = execFileSync('git', ['show', `${baselineCommit}:${path}`], { encoding: 'utf8' });
    await writeFile(
      target,
      path.endsWith('.ts')
        ? transpileModule(source.replaceAll("from 'zod'", `from '${zodUrl}'`), {
            compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
          }).outputText
        : source,
    );
  }
  baseline = (await import(pathToFileURL(join(baselineDir, 'index.js')).href)) as typeof baseline;
});
test.afterAll(async () => {
  if (baselineDir) await rm(baselineDir, { recursive: true, force: true });
});
const choice = {
  type: 'choice',
  options: [
    { id: 'out', label: 'Continue', criteria: 'Continue' },
    { id: 'no', label: 'Stop', criteria: 'Stop' },
  ],
};
const noul = {
  type: 'noul',
  true: { id: 'out', label: 'True', criteria: 'True' },
  false: { id: 'no', label: 'False', criteria: 'False' },
};
const score = {
  type: 'score',
  anchors: ['Low', 'High'],
  bands: [{ id: 'out', label: 'All', min: 0, max: 1 }],
};
const pairs = [
  ['expression', choice],
  ['expression', noul],
  ['classifier', choice],
  ['classifier', noul],
  ['classifier', score],
  ['llm', choice],
  ['llm', noul],
] as const;
type Config = Record<string, unknown>;
type Saved = {
  nodes: { id: string; config: Config }[];
  edges: { id: string; from: { node: string; port: string }; to: { node: string } }[];
};
function decision(kind = 'classifier', answer: unknown = choice) {
  const parsedAnswer = answer as ClassifierAnswerConfig;
  const context = { messages: 'all', vars: ['topic'], includeLastOutput: false };
  const routes =
    parsedAnswer.type === 'noul'
      ? [parsedAnswer.true, parsedAnswer.false].map(({ id, label }) => ({ id, label }))
      : parsedAnswer.type === 'choice'
        ? parsedAnswer.options.map(({ id, label }) => ({ id, label }))
        : [];
  return DecisionConfigSchema.parse(
    kind === 'expression'
      ? { kind, jsonata: '"out"', routes }
      : kind === 'llm'
        ? {
            kind,
            instructions: 'Choose a declared route for {{ vars.topic }}.',
            routes,
            harness: 'codex',
            model: { mode: 'explicit', value: 'gpt-6-luna' },
            effort: { mode: 'explicit', value: 'low' },
            context,
          }
        : {
            kind,
            answer,
            model: 'jev',
            question: 'Evaluate {{ vars.topic }}',
            minConfidence: 0.4,
            ...(parsedAnswer.type === 'noul' ? { truthThreshold: 0.6 } : {}),
            context,
            recordAlternatives: false,
          },
  );
}
async function create(request: APIRequestContext, kind: string, config: unknown, origin = '') {
  const loop = approvalLoop(`QA170 ${kind}`);
  const res = await request.post(`${origin}/loops`, {
    data: {
      definition: {
        ...loop,
        variables: { topic: { type: 'string' } },
        nodes: loop.nodes.map((node) => (node.id === 'approve' ? { ...node, kind, config } : node)),
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { loop: { id: string } }).loop.id;
}
async function saved(request: APIRequestContext, id: string, origin = ''): Promise<Saved> {
  const res = await request.get(`${origin}/loops/${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { draft: { definition: Saved } }).draft.definition;
}
async function config(request: APIRequestContext, id: string, origin = '') {
  return (await saved(request, id, origin)).nodes.find((node) => node.id === 'approve')!.config;
}
async function mirror(page: Page, id: string): Promise<Saved | undefined> {
  return page.evaluate(async (loopId) => {
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const opening = indexedDB.open('graphgoblin', 2);
      opening.onsuccess = () => resolveDb(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB open failed'));
    });
    try {
      return await new Promise<Saved | undefined>((resolveValue, reject) => {
        const reading = db.transaction('drafts', 'readonly').objectStore('drafts').get(loopId);
        reading.onsuccess = () =>
          resolveValue((reading.result as { definition?: Saved } | undefined)?.definition);
        reading.onerror = () => reject(reading.error ?? new Error('IndexedDB read failed'));
      });
    } finally {
      db.close();
    }
  }, id);
}
async function replace(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(text);
}
/** CodeMirror virtualizes long documents. Read through its copy event, not viewport innerText;
 * a synthetic clipboard keeps this entirely inside the page and leaves the OS clipboard alone. */
async function editorText(page: Page, editor: Locator) {
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+A');
  const text = await editor.evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
    );
    return clipboardData.getData('text/plain');
  });
  await page.keyboard.press('ArrowRight');
  return text;
}
async function chooseRadio(radio: Locator) {
  await radio.focus();
  await radio.press('Space');
  await expect(radio).toBeChecked();
}
const code = (dialog: Locator, path: string) =>
  dialog.locator(`[data-field="${path}"] .cm-content`).last();
async function selectTab(dialog: Locator, name: string) {
  const tab = dialog.getByRole('tab', { name: new RegExp(`^${name}\\b`) });
  if (await tab.count()) await tab.click();
}
async function expandAll(dialog: Locator) {
  for (const toggle of await dialog.getByRole('button', { name: /^Advanced\b/ }).all()) {
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  }
}
async function jsonEditor(dialog: Locator, label: string) {
  await dialog.getByRole('button', { name: `Edit as JSON: ${label}`, exact: true }).click();
  return dialog.getByRole('textbox', { name: `${label} JSON`, exact: true });
}
const sectionOf = (editor: Locator) => editor.locator('xpath=ancestor::*[@data-json-section][1]');
async function apply(editor: Locator) {
  await sectionOf(editor).getByRole('button', { name: 'Apply JSON', exact: true }).click();
}
async function cancel(editor: Locator) {
  await sectionOf(editor).getByRole('button', { name: 'Cancel JSON', exact: true }).click();
}
async function screenshot(dialog: Locator, name: string) {
  // Preserve the independent QA's committed evidence; reruns write only test artifacts.
  await dialog.screenshot({ path: test.info().outputPath(`${name}.png`) });
}
function at(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, key) => (v && typeof v === 'object' ? (v as Config)[key] : undefined),
      value,
    );
}

test('I1: main golden bytes and complete inference survive placement and edited save/reload', async ({
  page,
  request,
}) => {
  // Read the base artifact without switching, building or mutating main.
  const golden = JSON.parse(
    execFileSync(
      'git',
      ['show', `${baselineCommit}:packages/contracts/src/__golden__/loop-every-field.json`],
      { encoding: 'utf8' },
    ),
  ) as LoopDefinition;
  expect(JSON.stringify(LoopDefinitionSchema.parse(everyFieldLoop()))).toBe(JSON.stringify(golden));
  const original = golden.nodes.find((n) => n.kind === 'inference')!;
  if (original.kind !== 'inference') throw new Error('Missing golden inference');
  const id = await create(request, 'inference', original.config);
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  for (const path of [
    'harness',
    'model',
    'effort',
    'session',
    'session.key',
    'prompt.template',
    'harnessOptions.sandbox',
    'harnessOptions.approval',
    'harnessOptions.networkAccess',
    'harnessOptions.webSearch',
    'harnessOptions.configOverrides',
    'capabilities',
    'output.captureTranscript',
    'output.toMessages',
    'output.transforms',
    'output.schema.jsonSchema',
    'output.schema.native',
    'output.schema.repair.enabled',
    'output.schema.repair.maxAttempts',
    'output.schema.repair.prompt',
    'output.schema.repair.onFailure',
    'timeoutSeconds',
  ]) {
    await expect(dialog.locator(`[data-field="${path}"]`).first(), path).toBeVisible();
  }
  await selectTab(dialog, 'Context');
  await expandAll(dialog);
  for (const path of ['input', 'contextFiles.0.path', 'contextFiles.0.template'])
    await expect(dialog.locator(`[data-field="${path}"]`).first()).toBeVisible();
  expect(JSON.stringify(await config(request, id))).toBe(JSON.stringify(original.config));
  await dialog.locator('[data-field="contextFiles.0.path"] input').fill('notes/日本語.md');
  await replace(page, code(dialog, 'contextFiles.0.template'), 'α\n{{ vars.topic }}');
  await selectTab(dialog, 'Settings');
  await dialog.locator('[data-field="session.key"] input').fill('qa-session');
  await replace(page, code(dialog, 'prompt.template'), 'Unicode 🧪\n{{ vars.topic }}');
  await dialog.getByRole('spinbutton', { name: 'Timeout seconds' }).fill('42');
  await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-6-luna');
  await dialog.getByLabel('Effort', { exact: true }).selectOption('low');
  for (const [path, name] of [
    ['harnessOptions.sandbox', 'workspace-write'],
    ['harnessOptions.approval', 'never'],
    ['harnessOptions.networkAccess', 'No'],
    ['harnessOptions.webSearch', 'Yes'],
    ['output.captureTranscript', 'artifact'],
    ['output.toMessages', 'none'],
    ['output.schema.repair.onFailure', 'fail-run'],
  ] as const)
    await chooseRadio(
      dialog.locator(`[data-field="${path}"]`).getByRole('radio', { name, exact: true }),
    );
  await dialog.locator('[data-field="output.schema.native"]').getByRole('switch').click();
  await dialog.locator('[data-field="output.schema.repair.enabled"]').getByRole('switch').click();
  await dialog.locator('[data-field="output.schema.repair.maxAttempts"] input').fill('3');
  await replace(page, code(dialog, 'output.schema.jsonSchema'), '{"type":"string"}');
  await replace(page, code(dialog, 'output.schema.repair.prompt'), 'Repair\n{{ vars.topic }}');
  const expected = structuredClone(original.config);
  expected.model = 'gpt-6-luna';
  expected.effort = 'low';
  expected.harnessOptions.sandbox = 'workspace-write';
  expected.harnessOptions.approval = 'never';
  expected.harnessOptions.networkAccess = false;
  expected.harnessOptions.webSearch = true;
  expected.output.captureTranscript = 'artifact';
  expected.output.toMessages = 'none';
  expected.output.schema = {
    jsonSchema: { type: 'string' },
    native: true,
    repair: {
      enabled: false,
      maxAttempts: 3,
      prompt: 'Repair\n{{ vars.topic }}',
      onFailure: 'fail-run',
    },
  };
  expected.session = { policy: 'resume-named', key: 'qa-session' };
  expected.prompt.template = 'Unicode 🧪\n{{ vars.topic }}';
  expected.timeoutSeconds = 42;
  expected.contextFiles = [{ path: 'notes/日本語.md', template: 'α\n{{ vars.topic }}' }];
  await expect
    .poll(async () => JSON.stringify(await config(request, id)))
    .toBe(JSON.stringify(expected));
  expect(JSON.stringify(baseline.InferenceConfigSchema.parse(expected))).toBe(
    JSON.stringify(expected),
  );
  await page.reload();
  await openNode(page, 'approve');
  expect(JSON.stringify(await config(request, id))).toBe(JSON.stringify(expected));
});

for (const [kind, answer] of pairs) {
  test(`D1 decision ${kind}/${answer.type}: edits applicable source and saves across reload`, async ({
    page,
    request,
  }) => {
    const original = decision(kind, answer),
      id = await create(request, 'decision', original);
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    await expect(dialog.getByRole('radiogroup', { name: 'Decision kind' })).toBeVisible();
    const source = kind === 'expression' ? 'jsonata' : kind === 'llm' ? 'instructions' : 'question';
    const edited = kind === 'expression' ? '"no"' : 'Read all evidence.\n{{ vars.topic }}';
    await replace(page, code(dialog, source), edited);
    await expect.poll(async () => at(await config(request, id), source)).toBe(edited);
    const expected = DecisionConfigSchema.parse({ ...original, [source]: edited });
    expect(await config(request, id)).toEqual(expected);
    await page.reload();
    await openNode(page, 'approve');
    expect(await config(request, id)).toEqual(expected);
  });
}

const deep = Array.from({ length: 24 }).reduce<unknown>(
  (value, _, n) => ({ [`level${n}`]: value }),
  { value: '雪 🧪\nline', list: [null, false, 0] },
);
const sections = [
  {
    label: 'Input',
    path: 'input',
    tab: 'Context',
    value: [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: deep } }],
    empty: [],
    invalid: [{ op: 'not-real' }],
  },
  {
    label: 'Context files',
    path: 'contextFiles',
    tab: 'Context',
    value: [{ path: 'α/雪.md', template: 'Hello\n{{ vars.topic }}' }],
    empty: [],
    invalid: [{ path: '', template: 'x' }],
  },
  {
    label: 'Transforms',
    path: 'output.transforms',
    tab: 'Settings',
    value: [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: deep } }],
    empty: [],
    invalid: [{ op: 'set' }],
  },
  {
    label: 'Config overrides',
    path: 'harnessOptions.configOverrides',
    tab: 'Settings',
    value: { deep, list: Array.from({ length: 200 }, (_, n) => `雪${n}`) },
    empty: {},
    invalid: [],
  },
  {
    label: 'Capabilities',
    path: 'capabilities',
    tab: 'Settings',
    value: {
      mcpServers: Array.from({ length: 200 }, (_, n) => `server-${n}`),
      plugins: [],
      skills: ['authored'],
    },
    empty: {},
    invalid: { plugins: ['bad slug'] },
  },
] as const;
for (const entry of sections) {
  test(`I4/I5 ${entry.label}: syntax/schema refusal, pending isolation, structured roundtrip, empty and absent`, async ({
    page,
    request,
  }) => {
    const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    await selectTab(dialog, entry.tab);
    await expandAll(dialog);
    let editor = await jsonEditor(dialog, entry.label);
    const original = await config(request, id);
    for (const text of ['{broken', JSON.stringify(entry.invalid)]) {
      await replace(page, editor, text);
      await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
      await expect(editor).toHaveAttribute('aria-invalid', 'true');
      await expect(editor).toHaveAccessibleDescription(
        /Invalid|Too small|Too big|Unrecognized|must start/,
      );
      expect(await config(request, id)).toEqual(original);
    }
    await replace(page, editor, JSON.stringify(entry.value));
    await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeEnabled();
    // Force a separate valid save; inspect both persistence layers, not only the UI.
    await dialog.getByLabel('Label', { exact: true }).fill('Saved while JSON is pending');
    await expect
      .poll(async () => (await mirror(page, id))?.nodes.find((n) => n.id === 'approve')?.config)
      .toEqual(original);
    expect(await config(request, id)).toEqual(original);
    await apply(editor);
    await expect.poll(async () => at(await config(request, id), entry.path)).toEqual(entry.value);
    await dialog.getByRole('button', { name: `Use structured editor for ${entry.label}` }).click();
    editor = await jsonEditor(dialog, entry.label);
    expect(JSON.parse(await editorText(page, editor))).toEqual(entry.value);
    await replace(page, editor, JSON.stringify(entry.empty));
    await apply(editor);
    await expect.poll(async () => at(await config(request, id), entry.path)).toEqual(entry.empty);
    if (['Context files', 'Config overrides', 'Capabilities'].includes(entry.label)) {
      await replace(page, editor, '');
      await apply(editor);
      await expect.poll(async () => at(await config(request, id), entry.path)).toBeUndefined();
      await dialog
        .getByRole('button', { name: `Use structured editor for ${entry.label}` })
        .click();
      editor = await jsonEditor(dialog, entry.label);
      await expect(editor).toHaveText('');
    }
    await page.reload();
    expect(at(await config(request, id), entry.path)).toEqual(
      ['Input', 'Transforms'].includes(entry.label) ? [] : undefined,
    );
  });
}

test('I5 provider Context: 200 authored vars roundtrip and schema rejection leaves both stores intact', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', decision());
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  const editor = await jsonEditor(dialog, 'Context');
  const expected = {
    messages: 'none',
    vars: Array.from({ length: 200 }, (_, n) => `var-${n}`),
    includeLastOutput: true,
  };
  await replace(page, editor, JSON.stringify(expected));
  await apply(editor);
  await expect.poll(async () => at(await config(request, id), 'context')).toEqual(expected);
  await dialog.getByRole('button', { name: 'Use structured editor for Context' }).click();
  await expandAll(dialog);
  await expect(dialog.getByLabel('Vars 200', { exact: true })).toHaveValue('var-199');
  const again = await jsonEditor(dialog, 'Context');
  expect(JSON.parse(await editorText(page, again))).toEqual(expected);
  await replace(
    page,
    again,
    '{"messages":"not-real","vars":["bad slug"],"includeLastOutput":"yes"}',
  );
  await expect(sectionOf(again).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
  await expect
    .poll(async () =>
      at((await mirror(page, id))?.nodes.find((n) => n.id === 'approve')?.config, 'context'),
    )
    .toEqual(expected);
  expect(at(await config(request, id), 'context')).toEqual(expected);
  await cancel(again);
  expect(JSON.parse(await editorText(page, again))).toEqual(expected);
  await replace(page, again, '{"messages":"last","vars":[],"includeLastOutput":false}');
  await apply(again);
  await expect.poll(async () => at(await config(request, id), 'context.vars')).toEqual([]);
});

test('I5 bounded lists: 200 mutations, files and Choice options are rejected atomically', async ({
  page,
  request,
}) => {
  for (const [label, value, path, tab] of [
    [
      'Input',
      Array.from({ length: 200 }, () => ({ op: 'delete', path: '/vars/topic' })),
      'input',
      'Context',
    ],
    [
      'Transforms',
      Array.from({ length: 200 }, () => ({ op: 'delete', path: '/vars/topic' })),
      'output.transforms',
      'Settings',
    ],
    [
      'Context files',
      Array.from({ length: 200 }, (_, n) => ({ path: `${n}.txt`, template: 'hi' })),
      'contextFiles',
      'Context',
    ],
  ] as const) {
    const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    await selectTab(dialog, tab);
    await expandAll(dialog);
    const before = at(await config(request, id), path);
    const editor = await jsonEditor(dialog, label);
    await replace(page, editor, JSON.stringify(value));
    await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
    await expect(editor).toHaveAccessibleDescription(/Too big/);
    expect(at(await config(request, id), path)).toEqual(before);
  }
  const id = await create(request, 'decision', decision());
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const editor = await jsonEditor(dialog, 'Answer');
  await replace(
    page,
    editor,
    JSON.stringify({
      type: 'choice',
      options: Array.from({ length: 200 }, (_, n) => ({
        id: `route-${n}`,
        label: `Route ${n}`,
        criteria: 'yes',
      })),
    }),
  );
  await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
  expect((await config(request, id))['answer']).toEqual(choice);
});

test('I4 held JSON survives collapse, tabs, close, global undo/redo, blocked switch and Publish; Cancel restores', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, contextFiles: [] });
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  const advanced = await openAdvanced(dialog);
  const editor = await jsonEditor(dialog, 'Context files');
  const held = '  { "unfinished":\n  [雪';
  await replace(page, editor, held);
  await advanced.click();
  await expect(advanced).toContainText('1 error');
  await selectTab(dialog, 'Settings');
  await expect(dialog.getByRole('tab', { name: 'Context 1 error' })).toBeVisible();
  await dialog.getByLabel('Label', { exact: true }).fill('Unrelated edit');
  await selectTab(dialog, 'Context');
  await openAdvanced(dialog);
  expect(await editor.innerText()).toBe(held);
  await dialog.getByRole('button', { name: 'Use structured editor for Context files' }).click();
  await expect(dialog.getByText(/Apply or cancel.*before switching/)).toBeVisible();
  await screenshot(dialog, 'json-error-dark');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/not a valid value yet; complete or discard it first/)).toBeVisible();
  const server = (await (await request.get(`/loops/${id}`)).json()) as { current?: unknown };
  expect(server.current).toBeUndefined();
  expect((await config(request, id))['contextFiles']).toEqual([]);
  await expect
    .poll(
      async () =>
        (await mirror(page, id))?.nodes.find((n) => n.id === 'approve')?.config['contextFiles'],
    )
    .toEqual([]);
  dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  await openAdvanced(dialog);
  expect(await editor.innerText()).toBe(held);
  await cancel(editor);
  await selectTab(dialog, 'Settings');
  await dialog.getByRole('tab', { name: 'Settings' }).focus();
  await page.keyboard.press('Control+z');
  await selectTab(dialog, 'Context');
  expect(await editor.innerText()).toBe(held);
  await dialog.getByRole('tab', { name: /^Context/ }).focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveText('[]');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
});

for (const origin of ['canvas', 'title', 'publish'] as const) {
  test(`I3 ${origin}: issue focus opens hidden Context, Advanced and the JSON editor`, async ({
    page,
    request,
  }) => {
    const id = await create(request, 'inference', { prompt: { template: 'Hi' }, contextFiles: [] });
    await page.goto(`/app/loops/${id}/edit`);
    let dialog = await openNode(page, 'approve');
    await selectTab(dialog, 'Context');
    const advanced = await openAdvanced(dialog);
    const editor = await jsonEditor(dialog, 'Context files');
    await replace(page, editor, '{broken');
    await advanced.click();
    await selectTab(dialog, 'Settings');
    if (origin === 'title')
      await dialog.getByRole('button', { name: /issues? on approve$/ }).click();
    else {
      await closeNode(page);
      if (origin === 'publish') {
        await page.getByRole('button', { name: 'Publish', exact: true }).click();
        await expect(page.getByText(/not a valid value yet/)).toBeVisible();
        await page.getByRole('button', { name: '1 error', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Loop issues' })
          .getByRole('button', { name: 'approve: 1 issue' })
          .click();
        await page
          .getByRole('dialog', { name: 'Edit inference approve' })
          .getByRole('button', { name: /issues? on approve$/ })
          .click();
      } else
        await page
          .getByTestId('node-approve')
          .getByRole('button', { name: /issues? on approve$/ })
          .click();
    }
    await page.getByRole('button', { name: /FIELD_INPUT_INVALID.*config.contextFiles/ }).click();
    dialog = page.getByRole('dialog', { name: 'Edit inference approve' });
    await expect(dialog.getByRole('tab', { name: /^Context/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(dialog.getByRole('button', { name: /^Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('{broken');
  });
}

test('I2 Settings counts errors while Context is selected and reopening starts on Settings', async ({
  page,
  request,
}) => {
  // D2 declined: valid required controls need no indicator; every opening starts on Settings.
  const id = await create(request, 'decision', decision());
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  await expect(dialog.getByRole('radiogroup', { name: 'Answer type' })).toBeHidden();
  await expect(dialog.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Context.*1 set$/ })).toBeVisible();
  await selectTab(dialog, 'Settings');
  await dialog.locator('[data-field="answer.options.0.label"] input').fill('');
  await selectTab(dialog, 'Context');
  await expect(dialog.getByRole('tab', { name: /^Settings.*1 error$/ })).toBeVisible();
  await closeNode(page);
  const reopened = await openNode(page, 'approve');
  await expect(reopened.getByRole('tab', { name: /^Settings/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(reopened.getByRole('radiogroup', { name: 'Answer type' })).toBeVisible();
});

test('I3 history focus: Context switches and JSON Apply stay reachable through undo and redo remounts', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', decision());
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  await dialog.getByRole('spinbutton', { name: 'Min confidence' }).fill('0.75');
  await selectTab(dialog, 'Context');
  const last = dialog.getByRole('switch', { name: 'Include last output' });
  await last.click();
  await page.keyboard.press('Control+z');
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Control+z');
  await expect(last).toBeFocused();
  await expect(dialog.getByRole('tab', { name: /^Context/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect.poll(async () => at(await config(request, id), 'minConfidence')).toBe(0.4);
  await page.keyboard.press('Control+Shift+z');
  await expect(last).toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect(last).toHaveAttribute('aria-checked', 'true');
  await expect(last).toBeFocused();

  const inferId = await create(request, 'inference', {
    prompt: { template: 'Hi' },
    contextFiles: [],
  });
  await page.goto(`/app/loops/${inferId}/edit`);
  dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  await expandAll(dialog);
  const editor = await jsonEditor(dialog, 'Context files');
  const files = [{ path: 'qa.md', template: 'Hi' }];
  await replace(page, editor, JSON.stringify(files));
  await apply(editor);
  const applyButton = sectionOf(editor).getByRole('button', { name: 'Apply JSON' });
  await expect(applyButton).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(applyButton).toBeFocused();
  await expect(dialog.getByRole('tab', { name: /^Context/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('button', { name: /^Advanced/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect.poll(async () => (await config(request, inferId))['contextFiles']).toEqual([]);
  expect(JSON.parse(await editorText(page, editor))).toEqual(files);
  await applyButton.focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(applyButton).toBeFocused();
  await expect.poll(async () => (await config(request, inferId))['contextFiles']).toEqual(files);
});

test('inference session policies: named key errors stay visible; switching variants removes stale keys and history restores them', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const policy = dialog.getByRole('group', { name: 'Session', exact: true }).getByLabel('Policy');
  await expect(policy).toHaveValue('0');
  await policy.selectOption('1');
  await expect
    .poll(async () => (await config(request, id))['session'])
    .toEqual({ policy: 'resume-previous' });
  await policy.selectOption('2');
  const key = dialog.locator('[data-field="session.key"] input');
  await key.fill('invalid key');
  const invalid = InferenceConfigSchema.safeParse({
    prompt: { template: 'Hi' },
    session: { policy: 'resume-named', key: 'invalid key' },
  });
  const message = invalid.error!.issues.find(
    (issue) => issue.path.join('.') === 'session.key',
  )!.message;
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  await expect(key).toHaveAccessibleDescription(
    new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  expect((await config(request, id))['session']).toEqual({ policy: 'resume-previous' });
  await selectTab(dialog, 'Context');
  await expect(dialog.getByRole('tab', { name: 'Settings 1 error' })).toBeVisible();
  await selectTab(dialog, 'Settings');
  await key.fill('authored-session');
  await expect
    .poll(async () => (await config(request, id))['session'])
    .toEqual({ policy: 'resume-named', key: 'authored-session' });
  await policy.selectOption('0');
  await expect(key).toHaveCount(0);
  await expect
    .poll(async () => (await config(request, id))['session'])
    .toEqual({ policy: 'fresh' });
  await policy.focus();
  await page.keyboard.press('Control+z');
  await expect(policy).toBeFocused();
  await expect(key).toHaveValue('authored-session');
  await page.keyboard.press('Control+Shift+z');
  await expect(policy).toBeFocused();
  await expect(key).toHaveCount(0);
  await expect
    .poll(async () => (await config(request, id))['session'])
    .toEqual({ policy: 'fresh' });
  await page.reload();
  await openNode(page, 'approve');
  await expect(policy).toHaveValue('0');
});

for (const theme of ['dark', 'light']) {
  test(`I7 JSON ${theme}: every section wraps long invalid text without horizontal scrolling at all five widths`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
    for (const kind of ['inference', 'decision']) {
      const id = await create(
        request,
        kind,
        kind === 'inference' ? { prompt: { template: 'Hi' } } : decision(),
      );
      const before = await config(request, id);
      await page.goto(`/app/loops/${id}/edit`);
      const dialog = await openNode(page, 'approve');
      const sections =
        kind === 'inference'
          ? ([
              ['Settings', ['Config overrides', 'Capabilities', 'Transforms']],
              ['Context', ['Input', 'Context files']],
            ] as const)
          : ([
              ['Settings', ['Answer']],
              ['Context', ['Context']],
            ] as const);
      for (const [tab, labels] of sections) {
        await selectTab(dialog, tab);
        await expandAll(dialog);
        for (const label of labels) {
          const editor = await jsonEditor(dialog, label);
          await replace(page, editor, '{"unfinished":"' + '雪'.repeat(400));
          await expect(editor).toHaveAttribute('aria-invalid', 'true');
          await expect(
            sectionOf(editor).getByRole('button', { name: 'Apply JSON' }),
          ).toBeDisabled();
        }
      }
      for (const width of [360, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [tab, labels] of sections) {
          await selectTab(dialog, tab);
          for (const label of labels) {
            const editor = dialog.getByRole('textbox', { name: `${label} JSON`, exact: true });
            await editor.scrollIntoViewIfNeeded();
            await expect
              .poll(
                async () =>
                  sectionOf(editor).evaluate((root) => {
                    const dialog = root.closest('dialog')!;
                    const bounds = dialog.getBoundingClientRect();
                    return [...root.querySelectorAll<HTMLElement>('button,.cm-editor,.cm-scroller')]
                      .filter((el) => {
                        if (el.closest('[hidden], [inert]')) return false;
                        const box = el.getBoundingClientRect();
                        if (box.width <= 1 || box.height <= 1) return false;
                        return (
                          box.left < bounds.left ||
                          box.right > bounds.right ||
                          el.scrollWidth > el.clientWidth + 1
                        );
                      })
                      .map((el) => el.getAttribute('aria-label') ?? el.className);
                  }),
                `${kind} ${theme} ${width} ${label}`,
              )
              .toEqual([]);
            await expect(editor).toHaveAccessibleDescription(/Invalid JSON/);
          }
          expect(await dialog.evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);
        }
      }
      expect(await config(request, id)).toEqual(before);
    }
  });
}

test('I6 schema numbers and variable/pointer suggestions accept authored values and describe refusals', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', decision('classifier', noul));
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  for (const [name, path] of [
    ['Min confidence', 'minConfidence'],
    ['Noul true-probability threshold', 'truthThreshold'],
  ] as const) {
    const field = dialog.getByRole('spinbutton', { name });
    await expect(field).toHaveAttribute('min', '0');
    await expect(field).toHaveAttribute('max', '1');
    await expect(field).toHaveAttribute('step', 'any');
    for (const value of ['-0.1', '1.1']) {
      await field.fill(value);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAccessibleDescription(
        value.startsWith('-') ? /Too small/ : /Too big/,
      );
    }
    for (const value of ['0', '1', '0.123']) {
      await field.fill(value);
      await expect.poll(async () => at(await config(request, id), `${path}`)).toBe(Number(value));
    }
  }
  await selectTab(dialog, 'Context');
  await expandAll(dialog);
  const variable = dialog.getByLabel('Vars 1', { exact: true });
  const list = await variable.getAttribute('list');
  await expect(dialog.locator(`datalist[id="${list}"] option`)).toHaveAttribute('value', 'topic');
  await variable.fill('undeclared-valid');
  await expect
    .poll(async () => at(await config(request, id), 'context.vars'))
    .toEqual(['undeclared-valid']);
  await variable.fill('not a slug');
  await expect(variable).toHaveAttribute('aria-invalid', 'true');
  await expect(variable).toHaveAccessibleDescription(
    /must start with a letter and use letters, digits, _ or -/,
  );
  await variable.fill('topic');
  const mutationId = await create(request, 'mutate', {
    operations: [{ op: 'delete', path: '/vars/topic' }],
  });
  await page.goto(`/app/loops/${mutationId}/edit`);
  const mutation = await openNode(page, 'approve');
  await mutation.getByRole('button', { name: /^Operations 1/ }).click();
  const pointer = mutation.getByLabel('Path', { exact: true });
  await pointer.fill('/custom/a~1b');
  await expect
    .poll(async () => at(await config(request, mutationId), 'operations.0.path'))
    .toBe('/custom/a~1b');
  await pointer.fill('no-leading-slash');
  await expect(pointer).toHaveAttribute('aria-invalid', 'true');
  await expect(pointer).toHaveAccessibleDescription(/pointer|start|Invalid/i);
});

test('I8 tabs, labelled panels, visual focus order and JSON keyboard exit', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const settings = dialog.getByRole('tab', { name: 'Settings' });
  const context = dialog.getByRole('tab', { name: 'Context' });
  await settings.focus();
  for (const [key, selected] of [
    ['ArrowRight', context],
    ['ArrowRight', settings],
    ['ArrowLeft', context],
    ['Home', settings],
    ['End', context],
  ] as const) {
    await page.keyboard.press(key);
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    const panel = page.locator(`[id="${await selected.getAttribute('aria-controls')}"]`);
    await expect(panel).toHaveAccessibleName(await selected.innerText());
  }
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Edit as JSON: Input' })).toBeFocused();
  await page.keyboard.press('Enter');
  const editor = dialog.getByRole('textbox', { name: 'Input JSON', exact: true });
  await expect(editor).toHaveAccessibleDescription(/Mutations/);
  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sectionOf(editor).getByRole('button', { name: 'Cancel JSON' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sectionOf(editor).getByRole('button', { name: 'Apply JSON' })).toBeFocused();
});

for (const theme of ['dark', 'light']) {
  test(`I7 ${theme}: both forms and tabs fit every viewport; unrelated dialog retains width`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
    for (const kind of ['inference', 'decision']) {
      const id = await create(
        request,
        kind,
        kind === 'inference'
          ? {
              prompt: { template: 'A long prompt\n{{ vars.topic }}' },
              contextFiles: [{ path: 'notes.txt', template: 'Hello' }],
              input: [{ op: 'delete', path: '/vars/topic' }],
            }
          : decision('classifier', noul),
      );
      for (const width of [360, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/loops/${id}/edit`);
        const dialog = await openNode(page, 'approve');
        const box = (await dialog.boundingBox())!;
        expect(box.width).toBe(
          width < 768
            ? width
            : width < 1024
              ? 640
              : Math.min(width < 1280 ? 1248 : 1536, width - 32),
        );
        if (width < 768) expect(box.y + box.height).toBe(900);
        for (const tab of ['Settings', 'Context']) {
          await selectTab(dialog, tab);
          if (
            (kind === 'inference' && width === 360 && tab === 'Settings') ||
            (kind === 'decision' && width === 1440)
          )
            await screenshot(dialog, `${theme}-${kind}-${width}-${tab.toLowerCase()}`);
          await expandAll(dialog);
          const clipped = await dialog.evaluate((root) => {
            const failures: string[] = [];
            for (const element of root.querySelectorAll<HTMLElement>(
              'button,input:not([type=hidden]),select,textarea,.cm-editor',
            )) {
              if (element.closest('[hidden]')) continue;
              const el =
                element instanceof HTMLInputElement && element.type === 'radio'
                  ? element.closest('label')!
                  : element;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 1 || rect.height <= 1) continue;
              for (let parent = el.parentElement; parent; parent = parent.parentElement) {
                if (!/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX)) continue;
                const clip = parent.getBoundingClientRect();
                if (
                  rect.left < clip.left + parent.clientLeft - 1 ||
                  rect.right > clip.left + parent.clientLeft + parent.clientWidth + 1
                )
                  failures.push(
                    element.getAttribute('aria-label') ?? element.textContent ?? element.tagName,
                  );
              }
            }
            const body = root.querySelector(':scope > div')!;
            if (body.scrollWidth > body.clientWidth) failures.push('horizontal scroll');
            return failures;
          });
          expect(clipped, `${kind} ${theme} ${width} ${tab}`).toEqual([]);
        }
        await closeNode(page);
      }
      await page.goto('/app/loops');
      await page
        .locator('tr')
        .filter({ has: page.locator(`a[href="/app/loops/${id}/edit"]`) })
        .getByRole('button', { name: /^Delete/ })
        .click();
      expect((await page.getByRole('alertdialog').boundingBox())!.width).toBe(520);
      await page.keyboard.press('Escape');
    }
  });
}

test('conflict inside Context JSON retains pending text; overwrite saves applied values; reload closes dialog', async ({
  context,
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, contextFiles: [] });
  await page.goto(`/app/loops/${id}/edit`);
  const b = await context.newPage();
  await b.goto(`/app/loops/${id}/edit`);
  const aDialog = await openNode(page, 'approve');
  const bDialog = await openNode(b, 'approve');
  await selectTab(bDialog, 'Context');
  await expandAll(bDialog);
  const editor = await jsonEditor(bDialog, 'Context files');
  await replace(b, editor, '{held-conflict');
  await aDialog.getByLabel('Label', { exact: true }).fill('Tab A');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await bDialog.getByLabel('Label', { exact: true }).fill('Tab B');
  await expect(bDialog.getByText('The draft changed on the server')).toBeVisible();
  await expect(editor).toHaveText('{held-conflict');
  await bDialog.getByRole('button', { name: 'Overwrite with this copy' }).click();
  await expect(b.getByTestId('save-state')).toHaveText('All changes saved');
  expect((await config(request, id))['contextFiles']).toEqual([]);
  await expect(editor).toHaveText('{held-conflict');
  await aDialog.getByLabel('Label', { exact: true }).fill('Tab A stale');
  await expect(aDialog.getByText('The draft changed on the server')).toBeVisible();
  await aDialog.getByRole('button', { name: 'Reload server draft' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await b.close();
});

test('I6 incomplete optional numeric text keeps the last applied number in every persistence layer', async ({
  page,
  request,
}) => {
  // D1 regression: native badInput must retain the applied number and block publication.
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, timeoutSeconds: 30 });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  const field = dialog.getByRole('spinbutton', { name: 'Timeout seconds' });
  await field.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await field.pressSequentially('-');
  expect(await field.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
  await dialog.getByLabel('Label', { exact: true }).fill('Save while number is incomplete');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const persisted = await config(request, id);
  const local = (await mirror(page, id))?.nodes.find((n) => n.id === 'approve')?.config;
  await test.info().attach('D1-incomplete-number.json', {
    body: JSON.stringify(
      { persisted, local, ariaInvalid: await field.getAttribute('aria-invalid') },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await field.scrollIntoViewIfNeeded();
  await screenshot(dialog, 'numeric-incomplete-dark');
  expect.soft(await field.getAttribute('aria-invalid')).toBe('true');
  expect.soft(persisted['timeoutSeconds']).toBe(30);
  expect.soft(local?.['timeoutSeconds']).toBe(30);
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version 1\.|Publish failed/)).toBeVisible();
  const published = (await (await request.get(`/loops/${id}`)).json()) as { current?: unknown };
  await test.info().attach('D1-publish.json', {
    body: JSON.stringify(published.current ?? null, null, 2),
    contentType: 'application/json',
  });
  expect.soft(published.current).toBeUndefined();
});

test('I6 integer bounds: timeout and nested repair attempts use exact schema messages and preserve last good values', async ({
  page,
  request,
}) => {
  const original = InferenceConfigSchema.parse({
    prompt: { template: 'Hi' },
    timeoutSeconds: 30,
    output: { schema: { jsonSchema: {}, repair: { maxAttempts: 2 } } },
  });
  const id = await create(request, 'inference', original);
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  for (const [path, values, good] of [
    ['timeoutSeconds', [0, -1, 1.5, 86401], 86400],
    ['output.schema.repair.maxAttempts', [-1, 1.5, 11], 0],
  ] as const) {
    const field = dialog.locator(`[data-field="${path}"] input`);
    await expect(field).toHaveAttribute('step', '1');
    const before = at(await config(request, id), path);
    for (const number of values) {
      const bad = structuredClone(original);
      if (path === 'timeoutSeconds') bad.timeoutSeconds = number;
      else bad.output.schema!.repair.maxAttempts = number;
      const messages = InferenceConfigSchema.safeParse(bad)
        .error!.issues.filter((issue) => issue.path.join('.') === path)
        .map((issue) => issue.message);
      await field.fill(String(number));
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(await field.getAttribute('aria-describedby')).toBeTruthy();
      for (const message of messages)
        await expect(dialog.locator(`[data-field="${path}"]`)).toContainText(message);
      expect(at(await config(request, id), path)).toBe(before);
    }
    await field.fill(String(good));
    await expect.poll(async () => at(await config(request, id), path)).toBe(good);
  }
});

test('inference Claude and Codex: family selection, policy, advanced model/effort, save/reload and policy refusal', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { claude: true });
  const url = String(app['url']);
  const id = await create(
    request,
    'inference',
    { prompt: { template: 'Hi' }, harnessOptions: { sandbox: 'read-only' } },
    url,
  );
  await page.goto(`${url}/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await chooseRadio(dialog.getByRole('radio', { name: 'claude', exact: true }));
  await expect(dialog.getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue('0');
  await expandAll(dialog);
  const model = dialog.getByLabel('Model', { exact: true });
  await model.selectOption('claude-opus-5-5');
  await dialog.getByLabel('Effort', { exact: true }).selectOption('xhigh');
  await expect
    .poll(() => config(request, id, url))
    .toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' });
  await selectTab(dialog, 'Context');
  const input = await jsonEditor(dialog, 'Input');
  await replace(page, input, '[{"op":"delete","path":"/vars/topic"}]');
  await apply(input);
  await selectTab(dialog, 'Settings');
  await expandAll(dialog);
  const overrides = await jsonEditor(dialog, 'Config overrides');
  await replace(page, overrides, '{"authored":true}');
  // Parent policy refuses the locally valid record before it can become applied state.
  await expect(sectionOf(overrides).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
  await expect(
    sectionOf(overrides).getByText('Claude raw configuration overrides are unsupported', {
      exact: false,
    }),
  ).toBeVisible();
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Publish failed')).toBeVisible();
  const repaired = await openNode(page, 'approve');
  await expandAll(repaired);
  const json = repaired.getByRole('textbox', { name: 'Config overrides JSON', exact: true });
  if (!(await json.isVisible()))
    await repaired.getByRole('button', { name: 'Edit as JSON: Config overrides' }).click();
  await replace(page, json, '{}');
  await apply(json);
  await expect
    .poll(() => config(request, id, url))
    .toMatchObject({ harness: 'claude', harnessOptions: { configOverrides: {} } });
  await page.reload();
  const reopened = await openNode(page, 'approve');
  await expandAll(reopened);
  await expect(reopened.getByLabel('Model', { exact: true })).toHaveValue('claude-opus-5-5');
  await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue('xhigh');
  await chooseRadio(reopened.getByRole('radio', { name: 'codex', exact: true }));
  await expect(reopened.getByLabel('Model', { exact: true })).toHaveValue('claude-opus-5-5');
  await reopened.getByLabel('Model', { exact: true }).selectOption('gpt-6-luna');
  await reopened.getByLabel('Effort', { exact: true }).selectOption('low');
  await expect.poll(() => config(request, id, url)).toMatchObject({ harness: 'codex' });
  await expect(reopened.getByRole('radiogroup', { name: 'Sandbox', exact: true })).toBeVisible();
});

for (const kind of ['expression', 'classifier', 'llm']) {
  test(`route replacement ${kind}: retained IDs reorder safely, explicit remove drops edge, and undo/redo is atomic`, async ({
    page,
    request,
  }) => {
    const id = await create(request, 'decision', decision(kind));
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    const section = kind === 'classifier' ? 'Answer' : 'Routes';
    const editor = await jsonEditor(dialog, section);
    const routes = [...choice.options].reverse().map(({ id, label }) => ({ id, label }));
    const reordered =
      kind === 'classifier' ? { ...choice, options: [...choice.options].reverse() } : routes;
    await replace(page, editor, JSON.stringify(reordered));
    await apply(editor);
    await expect
      .poll(async () => (await config(request, id))[kind === 'classifier' ? 'answer' : 'routes'])
      .toEqual(reordered);
    expect((await saved(request, id)).edges.find((e) => e.id === 'e2')!.from.port).toBe('out');
    const added =
      kind === 'classifier'
        ? {
            ...choice,
            options: [...choice.options]
              .reverse()
              .concat({ id: 'third', label: 'Third', criteria: 'Third' }),
          }
        : [...routes, { id: 'third', label: 'Third' }];
    await replace(page, editor, JSON.stringify(added));
    await apply(editor);
    const removed = Array.isArray(added)
      ? added.filter((row) => row.id !== 'out')
      : { ...added, options: added.options.filter((row) => row.id !== 'out') };
    await replace(page, editor, JSON.stringify(removed));
    await apply(editor);
    await expect(
      sectionOf(editor).getByRole('group', { name: 'Confirm connection removal' }),
    ).toContainText('out → done');
    await sectionOf(editor).getByRole('button', { name: 'Confirm Apply JSON' }).click();
    await expect
      .poll(async () => (await saved(request, id)).edges.some((e) => e.id === 'e2'))
      .toBe(false);
    await sectionOf(editor).getByRole('button', { name: 'Apply JSON' }).focus();
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await saved(request, id)).edges.some((e) => e.id === 'e2'))
      .toBe(true);
    await expect(editor).toBeVisible();
    await sectionOf(editor).getByRole('button', { name: 'Apply JSON' }).focus();
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(async () => (await saved(request, id)).edges.some((e) => e.id === 'e2'))
      .toBe(false);
  });
}

for (const [label, value] of [
  ['Config overrides', { raw: true }],
  ['Capabilities', { skills: ['authored'] }],
] as const) {
  test(`I4 parent validation ${label}: invalid Claude JSON must not apply or reach the device draft`, async ({
    page,
    request,
  }) => {
    // D3 regression: section replacements must satisfy the whole node's parent refinements.
    const app = await control(request, '/apps', { claude: true });
    const url = String(app['url']);
    const id = await create(
      request,
      'inference',
      {
        harness: 'claude',
        prompt: { template: 'Hi' },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      },
      url,
    );
    const original = await config(request, id, url);
    await page.goto(`${url}/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    await expandAll(dialog);
    const editor = await jsonEditor(dialog, label);
    await replace(page, editor, JSON.stringify(value));
    const button = sectionOf(editor).getByRole('button', { name: 'Apply JSON' });
    const enabled = await button.isEnabled();
    if (enabled) await button.click();
    await dialog.getByLabel('Label', { exact: true }).fill('Trigger mirror after JSON');
    await expect(page.getByTestId('save-state')).toHaveText(
      /All changes saved|Saved on this device only/,
    );
    const local = (await mirror(page, id))?.nodes.find((n) => n.id === 'approve')?.config;
    const rawPath = label === 'Capabilities' ? 'capabilities' : 'harnessOptions.configOverrides';
    console.log(
      `D3 ${label}: Apply enabled=${enabled}; device=${JSON.stringify(at(local, rawPath))}; server=${JSON.stringify(at(await config(request, id, url), rawPath))}`,
    );
    if (label === 'Config overrides') {
      await editor.scrollIntoViewIfNeeded();
      await screenshot(dialog, 'claude-json-parent-error-dark');
    }
    expect.soft(enabled).toBe(false);
    expect.soft(at(local, rawPath)).toEqual(at(original, rawPath));
    expect(await config(request, id, url)).toEqual(original);
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Publish failed')).toBeVisible();
  });
}

test('I4 valid unapplied JSON is pending, survives reopening, blocks Publish and cancels without a change', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, capabilities: {} });
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  const editor = await jsonEditor(dialog, 'Capabilities');
  const pending = '{ "skills": ["authored"] }';
  await replace(page, editor, pending);
  await expect(editor).not.toHaveAttribute('aria-invalid', 'true');
  await expect(editor).toHaveAccessibleDescription(/Choose Apply JSON or Cancel JSON/);
  await selectTab(dialog, 'Context');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Publish failed')).toBeVisible();
  await expect(page.getByText(/JSON not applied yet; apply or cancel it first/)).toBeVisible();
  expect((await config(request, id))['capabilities']).toEqual({});
  dialog = await openNode(page, 'approve');
  await expandAll(dialog);
  expect(await editorText(page, editor)).toBe(pending);
  await cancel(editor);
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
});

test('I5 Score: 200 unicode rubric anchors roundtrip; split, connect, rename and remove bands atomically', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', decision('classifier', score));
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  let editor = await jsonEditor(dialog, 'Answer');
  const large = {
    type: 'score',
    anchors: Array.from({ length: 200 }, (_, n) => `雪 ${n}\nline`),
    bands: [{ id: 'out', label: 'All', min: 0, max: 199 }],
  };
  await replace(page, editor, JSON.stringify(large));
  await apply(editor);
  await expect.poll(async () => (await config(request, id))['answer']).toEqual(large);
  await dialog.getByRole('button', { name: 'Use structured editor for Answer' }).click();
  await expect(dialog.getByLabel('Anchors 200', { exact: true })).toHaveValue('雪 199\nline');
  editor = await jsonEditor(dialog, 'Answer');
  expect(JSON.parse(await editorText(page, editor))).toEqual(large);
  const split = {
    ...large,
    bands: [
      { id: 'out', label: 'Low', min: 0, max: 100.5 },
      { id: 'high', label: 'High', min: 100.5, max: 199 },
    ],
  };
  await replace(page, editor, JSON.stringify(split));
  await apply(editor);
  await dialog.getByLabel('Output', { exact: true }).selectOption('high');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect
    .poll(async () => (await saved(request, id)).edges.some((e) => e.from.port === 'high'))
    .toBe(true);
  const renamed = { ...split, bands: [split.bands[0], { ...split.bands[1], id: 'top' }] };
  await replace(page, editor, JSON.stringify(renamed));
  await apply(editor);
  await expect(
    sectionOf(editor).getByRole('group', { name: 'Confirm connection removal' }),
  ).toContainText('high → done');
  await sectionOf(editor).getByRole('button', { name: 'Confirm Apply JSON' }).click();
  await expect
    .poll(async () =>
      (await saved(request, id)).edges.some((e) => e.from.port === 'high' || e.from.port === 'top'),
    )
    .toBe(false);
  // Reconnect explicitly: the following removal still exercises an applied connection on top.
  await dialog.getByLabel('Output', { exact: true }).selectOption('top');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect
    .poll(async () => (await saved(request, id)).edges.some((e) => e.from.port === 'top'))
    .toBe(true);
  await replace(page, editor, JSON.stringify(large));
  await apply(editor);
  await expect(
    sectionOf(editor).getByRole('group', { name: 'Confirm connection removal' }),
  ).toContainText('top → done');
  await sectionOf(editor).getByRole('button', { name: 'Confirm Apply JSON' }).click();
  await expect
    .poll(async () => (await saved(request, id)).edges.some((e) => e.from.port === 'top'))
    .toBe(false);
  expect((await saved(request, id)).edges.find((e) => e.id === 'e2')?.from.port).toBe('out');
});

test('shared mutations: every operation roundtrips; all four pointer suggestions retain authored RFC6901 paths', async ({
  page,
  request,
}) => {
  const source = everyFieldLoop().nodes.find((node) => node.kind === 'mutate');
  if (source?.kind !== 'mutate') throw new Error('Missing all-operation fixture');
  const expected = InferenceConfigSchema.parse({
    prompt: { template: 'Hi' },
    input: source.config.operations,
  });
  const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await selectTab(dialog, 'Context');
  const editor = await jsonEditor(dialog, 'Input');
  await replace(page, editor, JSON.stringify(expected.input));
  await apply(editor);
  await expect.poll(async () => (await config(request, id))['input']).toEqual(expected.input);
  await dialog.getByRole('button', { name: 'Use structured editor for Input' }).click();
  const paths: string[] = [];
  expected.input.forEach((op, index) => {
    if (op.op === 'set' || op.op === 'delete') paths.push(`input.${index}.path`);
    if (op.op === 'coerce') paths.push(`input.${index}.source`, `input.${index}.target`);
  });
  for (const path of paths) {
    const rowIndex = Number(path.split('.')[1]);
    const row = dialog.getByRole('button', { name: new RegExp(`^Input ${rowIndex + 1} `) });
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
    const field = dialog.locator(`[data-field="${path}"] input`);
    const list = await field.getAttribute('list');
    await expect(dialog.locator(`datalist[id="${list}"] option`)).toHaveAttribute(
      'value',
      '/vars/topic',
    );
    await field.fill('/custom/雪~1a~0b');
    await expect.poll(async () => at(await config(request, id), path)).toBe('/custom/雪~1a~0b');
    await field.fill('/bad~2escape');
    await expect(field).toHaveAccessibleDescription(/must be an RFC 6901 JSON Pointer/);
    await field.fill('');
    await expect.poll(async () => at(await config(request, id), path)).toBe('');
  }
});

test('HTTP catalog evaluator: Choice, Noul and Score select the known model; disabling it preserves an explicit invalid selection', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { realClassifiers: true });
  const url = String(app['url']);
  const fake = await control(request, '/classifier/start');
  expect(
    (
      await request.put(`${url}/classifier-models/qa170-http`, {
        data: {
          displayName: 'QA170 HTTP',
          providerModel: 'test-model',
          endpoint: String(fake['endpoint']),
          primitives: ['choice', 'noul', 'score'],
          provider: 'http',
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await request.patch(`${url}/classifier-models/qa170-http`, { data: { enabled: true } })).ok(),
  ).toBe(true);
  for (const answer of [choice, noul, score]) {
    const initial = decision('classifier', answer);
    if (initial.kind !== 'classifier') throw new Error('Fixture kind');
    initial.model = 'qa170-http';
    const id = await create(request, 'decision', initial, url);
    await page.goto(`${url}/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    const picker = dialog.getByRole('combobox', { name: 'Model', exact: true });
    await expect(picker).toHaveValue('qa170-http');
    await picker.selectOption('jev');
    await expect.poll(async () => at(await config(request, id, url), 'model')).toBe('jev');
    await picker.selectOption('qa170-http');
    await expect.poll(async () => at(await config(request, id, url), 'model')).toBe('qa170-http');
    expect(
      (
        await request.patch(`${url}/classifier-models/qa170-http`, { data: { enabled: false } })
      ).ok(),
    ).toBe(true);
    await page.reload();
    const reopened = await openNode(page, 'approve');
    await expect(reopened.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(
      'qa170-http',
    );
    await expect(
      reopened.getByRole('combobox', { name: 'Model', exact: true }),
    ).toHaveAccessibleDescription(/disabled/i);
    expect(
      (
        await request.patch(`${url}/classifier-models/qa170-http`, { data: { enabled: true } })
      ).ok(),
    ).toBe(true);
  }
});
