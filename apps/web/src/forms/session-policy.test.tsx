import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderNodeEditor } from '../__fixtures__/node-editor.js';
import { defaultConfig, newLoopDefinition } from '../editor/model.js';
import { RESUME_NOTE } from '../editor/SessionPicker.js';
import { useEditorStore } from '../editor/store.js';

const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const store = () => useEditorStore.getState();

const SECTION =
  'Choose whether each visit starts a new conversation or resumes an existing one. Prompt, input and context files determine the information supplied for the visit.';
const POLICIES = [
  {
    policy: 'fresh',
    label: 'Start fresh',
    help: 'Starts a new provider conversation on each visit. Your prompt and selected loop context still apply; earlier provider conversation history is not resumed.',
  },
  {
    policy: 'resume-previous',
    label: 'Resume latest in this run',
    help: 'Resumes the most recent conversation recorded in this run for the same harness, including one used by another node. If none has been recorded, starts fresh.',
  },
  {
    policy: 'resume-named',
    label: 'Resume named conversation',
    help: 'Resumes the conversation recorded under the name below for this loop and harness. Nodes and runs of this loop using the same name share it. If none has been recorded, starts fresh.',
  },
  {
    policy: 'resume-own',
    label: "Resume this node's conversation",
    help: "Resumes this node's conversation from its earlier visits in this run with the same harness. The first visit starts fresh. This selects this node's history; it does not prevent another node using Resume latest in this run from continuing that conversation.",
  },
] as const;
const NAME_HELP =
  'Nodes and runs of this loop using the same name and harness share a conversation. Use a different name for a separate conversation.';
const RESET_HELP =
  'Leave blank for no automatic reset. After this many completed visits, the next visit starts a new conversation. For example, 2 groups visits 1-2, 3-4, and so on. Retries and repairs do not count as additional visits. Shared loop context is kept.';

type InferenceInput = Extract<NodeInput, { kind: 'inference' }>['config'];

function loopWith(config: InferenceInput): LoopDefinitionInput {
  const definition = newLoopDefinition('session');
  return {
    ...definition,
    nodes: [...definition.nodes, { id: 'infer', kind: 'inference', label: 'Infer', config }],
  };
}

async function openInference(config: InferenceInput, autosave = false) {
  const api = new FakeApi();
  const definition = loopWith(config);
  const loop = api.addLoop(definition);
  renderNodeEditor(loop.id, definition, 'infer', api, { autosave });
  const dialog = await screen.findByRole('dialog', { name: 'Edit inference infer' });
  await within(dialog).findByRole('form', { name: 'infer config' });
  return { api, loopId: loop.id, dialog };
}

/** The node's config as the editor store holds it (what autosave sends). */
const config = () =>
  store().definition!.nodes.find((node) => node.id === 'infer')!.config as Record<string, unknown>;

const panelOf = (dialog: HTMLElement, tab: string) => {
  const control = within(dialog).getByRole('tab', { name: new RegExp(`^${tab}`) });
  return document.getElementById(control.getAttribute('aria-controls')!)!;
};

const fieldPaths = (root: ParentNode, expected: readonly string[]) => [
  ...new Set(
    [...root.querySelectorAll('[data-field]')]
      .map((field) => field.getAttribute('data-field') ?? '')
      .filter((path) => expected.includes(path)),
  ),
];

/** A description that begins with `text` and goes on (an error message after the help). */
const startsWith = (text: string) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}.+`);
};

const conversation = (dialog: HTMLElement) =>
  within(dialog).getByRole('combobox', { name: 'Conversation' });

describe('inference Context: Prompt and Session', () => {
  it('places Prompt, Session, Input and Advanced Files once on Context, in order, outside Advanced', async () => {
    const user = userEvent.setup();
    const { dialog } = await openInference({
      prompt: { template: 'Summarise' },
      contextFiles: [{ path: 'notes.md', template: 'n' }],
    });
    // Prompt and Session each have one editor in the dialog.
    for (const path of ['prompt', 'session'])
      expect(dialog.querySelectorAll(`[data-field="${path}"]`), path).toHaveLength(1);
    expect(dialog.querySelectorAll('[data-field="prompt.template"] .cm-content')).toHaveLength(1);
    expect(
      within(dialog).getAllByRole('combobox', { name: 'Conversation', hidden: true }),
    ).toHaveLength(1);
    // Settings keeps its controls and no longer holds them; it is still where a dialog opens.
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const settings = panelOf(dialog, 'Settings');
    expect(fieldPaths(settings, ['prompt', 'session', 'input', 'contextFiles'])).toEqual([]);
    expect(within(settings).getByRole('radiogroup', { name: 'Harness' })).toBeVisible();
    expect(within(settings).getByLabelText('Model', { exact: true })).toBeVisible();
    expect(within(settings).getByLabelText('Effort', { exact: true })).toBeVisible();
    expect(within(settings).getByRole('radiogroup', { name: 'Sandbox' })).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    const context = panelOf(dialog, 'Context');
    expect(fieldPaths(context, ['prompt', 'session', 'input', 'contextFiles'])).toEqual([
      'prompt',
      'session',
      'input',
      'contextFiles',
    ]);
    const advanced = within(context).getByRole('button', { name: /^Advanced/ });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    // Prompt and Session are in sight without opening Advanced; Files waits behind it.
    const prompt = within(context).getByRole('group', { name: 'Prompt' });
    const session = within(context).getByRole('group', { name: 'Session' });
    expect(prompt).toBeVisible();
    expect(prompt).toHaveAccessibleDescription('Liquid template rendered against the thread.');
    expect(getCode('Template')).toBe('Summarise');
    expect(session).toBeVisible();
    expect(conversation(dialog)).toBeVisible();
    expect(within(context).getByRole('group', { name: 'Input' })).toBeVisible();
    const files = context.querySelector('[data-field="contextFiles"]')!;
    expect(files.closest('[hidden]')).not.toBeNull();
    expect(
      session.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(advanced);
    expect(within(context).getByRole('group', { name: 'Files' })).toBeVisible();
  });

  it('labels each policy, explains the chosen one, and shows only its own field', async () => {
    const user = userEvent.setup();
    const { dialog } = await openInference({ prompt: { template: 'Summarise' } });
    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    const session = within(dialog).getByRole('group', { name: 'Session' });
    const select = conversation(dialog);
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual(
      POLICIES.map(({ label }) => label),
    );
    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual(
      POLICIES.map(({ policy }) => policy),
    );
    // The section description sits under the heading, before the selector.
    const section = within(session).getByText(SECTION);
    expect(
      section.compareDocumentPosition(within(session).getByText('Conversation')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const { policy, label, help } of POLICIES) {
      await user.selectOptions(select, policy);
      expect(conversation(dialog)).toHaveValue(policy);
      expect(conversation(dialog)).toHaveDisplayValue(label);
      const resumes = policy !== 'fresh';
      expect(conversation(dialog)).toHaveAccessibleDescription(
        [SECTION, help, ...(resumes ? [RESUME_NOTE] : [])].join(' '),
      );
      expect(within(session).getByText(help)).toBeVisible();
      for (const other of POLICIES.filter((candidate) => candidate.policy !== policy))
        expect(within(session).queryByText(other.help)).toBeNull();
      if (resumes) expect(within(session).getByText(RESUME_NOTE)).toBeVisible();
      else expect(within(session).queryByText(RESUME_NOTE)).toBeNull();
      const name = within(session).queryByRole('textbox', { name: 'Conversation name' });
      const reset = within(session).queryByRole('spinbutton', { name: 'Reset after visits' });
      // A new name starts blank, which the slug rule reports after the help.
      if (policy === 'resume-named')
        expect(name).toHaveAccessibleDescription(startsWith(NAME_HELP));
      else expect(name).toBeNull();
      if (policy === 'resume-own') expect(reset).toHaveAccessibleDescription(RESET_HELP);
      else expect(reset).toBeNull();
    }
  });

  it('opens a new node at Start fresh and writes nothing by viewing it', async () => {
    const user = userEvent.setup();
    const { dialog } = await openInference(defaultConfig('inference') as InferenceInput);
    // The loaded draft holds the contract default, as an API read does.
    const before = structuredClone(config());
    expect(before['session']).toEqual({ policy: 'fresh' });
    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    expect(conversation(dialog)).toHaveValue('fresh');
    expect(conversation(dialog)).toHaveDisplayValue('Start fresh');
    await user.click(within(dialog).getByRole('tab', { name: /^Settings/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(config()).toEqual(before);
  });

  it('keeps a stored policy exactly and saves edits as before', async () => {
    const user = userEvent.setup();
    const stored = await openInference({
      prompt: { template: 'Summarise' },
      session: { policy: 'resume-own', resetAfterVisits: 2 },
    });
    await user.click(within(stored.dialog).getByRole('tab', { name: /^Context/ }));
    expect(conversation(stored.dialog)).toHaveValue('resume-own');
    expect(conversation(stored.dialog)).toHaveDisplayValue("Resume this node's conversation");
    const reset = within(stored.dialog).getByRole('spinbutton', { name: 'Reset after visits' });
    expect(reset).toHaveValue(2);
    await user.clear(reset);
    expect(config()['session']).toEqual({ policy: 'resume-own' });
    await user.type(reset, '3');
    expect(config()['session']).toEqual({ policy: 'resume-own', resetAfterVisits: 3 });
    await user.selectOptions(conversation(stored.dialog), 'resume-named');
    await user.type(
      within(stored.dialog).getByRole('textbox', { name: 'Conversation name' }),
      'shared-notes',
    );
    expect(config()['session']).toEqual({ policy: 'resume-named', key: 'shared-notes' });
    await user.selectOptions(conversation(stored.dialog), 'resume-previous');
    expect(config()['session']).toEqual({ policy: 'resume-previous' });
  });

  it('autosaves a policy and a name without moving focus', async () => {
    const user = userEvent.setup();
    const { api, loopId, dialog } = await openInference(
      { prompt: { template: 'Summarise' } },
      true,
    );
    const saved = () =>
      (
        api.loops.get(loopId)!.draft!.definition.nodes.find((node) => node.id === 'infer')!
          .config as Record<string, unknown>
      )['session'];
    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    await user.selectOptions(conversation(dialog), 'resume-named');
    const name = within(dialog).getByRole('textbox', { name: 'Conversation name' });
    await user.type(name, 'shared');
    await waitFor(() => expect(saved()).toEqual({ policy: 'resume-named', key: 'shared' }), {
      timeout: 5000,
    });
    expect(name).toHaveFocus();
    expect(within(dialog).getByRole('tab', { name: /^Context/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('makes a policy change one undo step that restores the earlier policy and its name', async () => {
    const user = userEvent.setup();
    const { dialog } = await openInference({
      prompt: { template: 'Summarise' },
      session: { policy: 'resume-named', key: 'notes' },
    });
    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    await user.selectOptions(conversation(dialog), 'fresh');
    expect(config()['session']).toEqual({ policy: 'fresh' });
    expect(within(dialog).queryByRole('textbox', { name: 'Conversation name' })).toBeNull();
    expect(conversation(dialog)).toHaveFocus();
    await user.keyboard(UNDO);
    expect(config()['session']).toEqual({ policy: 'resume-named', key: 'notes' });
    expect(conversation(dialog)).toHaveValue('resume-named');
    expect(conversation(dialog)).toHaveFocus();
    expect(within(dialog).getByRole('textbox', { name: 'Conversation name' })).toHaveValue('notes');
    expect(within(dialog).getByRole('tab', { name: /^Context/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard(REDO);
    expect(config()['session']).toEqual({ policy: 'fresh' });
    expect(conversation(dialog)).toHaveValue('fresh');
  }, 30_000);

  it('keeps name, reset and prompt errors with their fields and follows issues into Context', async () => {
    const user = userEvent.setup();
    const { dialog } = await openInference({
      prompt: { template: 'Hi {% if x %}' },
      session: { policy: 'resume-named', key: 'notes' },
    });
    const contextTab = () => within(dialog).getByRole('tab', { name: /^Context/ });
    const settingsTab = () => within(dialog).getByRole('tab', { name: /^Settings/ });
    // The loop's template check counts on Context, where the prompt is, not on Settings.
    await waitFor(() => expect(contextTab()).toHaveAccessibleName('Context 2 set 1 error'));
    expect(settingsTab()).toHaveAccessibleName('Settings');
    act(() => store().openNode('infer', { field: 'config.prompt.template' }));
    const template = dialog.querySelector<HTMLElement>(
      '[data-field="prompt.template"] .cm-content',
    )!;
    await waitFor(() => expect(template).toHaveFocus());
    expect(contextTab()).toHaveAttribute('aria-selected', 'true');

    const typed = within(dialog).getByRole('textbox', { name: 'Conversation name' });
    await user.clear(typed);
    await user.type(typed, 'bad key');
    // The editor's draft holds what was typed; validation flags it (autosave keeps it local).
    expect(config()['session']).toEqual({ policy: 'resume-named', key: 'bad key' });
    expect(contextTab()).toHaveAccessibleName(/^Context 2 set \d errors?$/);
    expect(settingsTab()).toHaveAccessibleName('Settings');
    await user.click(settingsTab());
    act(() => store().openNode('infer', { field: 'config.session.key' }));
    const name = within(dialog).getByRole('textbox', { name: 'Conversation name' });
    await waitFor(() => expect(name).toHaveFocus());
    expect(contextTab()).toHaveAttribute('aria-selected', 'true');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(startsWith(`${NAME_HELP} `));

    await user.selectOptions(conversation(dialog), 'resume-own');
    const reset = within(dialog).getByRole('spinbutton', { name: 'Reset after visits' });
    await user.type(reset, '0');
    expect(reset).toHaveAttribute('aria-invalid', 'true');
    expect(reset).toHaveAccessibleDescription(startsWith(`${RESET_HELP} `));
    expect(config()['session']).toEqual({ policy: 'resume-own' });
  }, 30_000);
});
