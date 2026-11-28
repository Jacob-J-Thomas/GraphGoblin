import {
  CODEX_CONFIG_KEY_MESSAGE,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderNodeEditor } from '../__fixtures__/node-editor.js';
import { newLoopDefinition } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import { AUTOSAVE_DELAY_MS } from '../editor/useAutosave.js';

/**
 * A Codex config override's JSON Value in the node editor, with the editor store and autosave
 * (#429): a member named "__proto__" parses as an own member that the form cannot keep. The value
 * is held as typed instead of being saved without it.
 */

type InferenceInput = Extract<NodeInput, { kind: 'inference' }>['config'];

const store = () => useEditorStore.getState();
const VALUE_PATH = 'harnessOptions.configOverrides.example';
const COMMITTED = { example: { previous: true }, neighbor: 'unchanged' };

function loopWith(config: InferenceInput): LoopDefinitionInput {
  const definition = newLoopDefinition('overrides');
  return {
    ...definition,
    nodes: [...definition.nodes, { id: 'infer', kind: 'inference', label: 'Infer', config }],
  };
}

function harnessOptionsOf(definition: LoopDefinitionInput | undefined) {
  const node = definition?.nodes.find((entry) => entry.id === 'infer');
  return (node?.config as { harnessOptions?: Record<string, unknown> } | undefined)?.harnessOptions;
}

async function openOverrides(api: FakeApi, loopId: string, definition: LoopDefinitionInput) {
  renderNodeEditor(loopId, definition, 'infer', api, { autosave: true });
  const dialog = await screen.findByRole('dialog', { name: 'Edit inference infer' });
  await within(dialog).findByRole('form', { name: 'infer config' });
  openAdvanced(dialog);
  return dialog;
}

describe('Codex config override values in the node editor (#429)', () => {
  // The final audit's two inputs, and a member two objects down.
  it.each([
    ['{"marker":"reserved-changed","__proto__":false,"survivor":true}', '__proto__'],
    ['{"marker":"array-changed","rows":[{"__proto__":false,"enabled":true}]}', 'rows.0.__proto__'],
    [
      '{"marker":"held","outer":{"inner":{"__proto__":false}},"rows":[{"enabled":true}]}',
      'outer.inner.__proto__',
    ],
  ])(
    'holds the Value %s without saving it narrowed, then saves it whole once corrected',
    async (text, path) => {
      const user = userEvent.setup();
      const api = new FakeApi();
      const definition = loopWith({
        prompt: { template: 'Summarise the notes.' },
        harnessOptions: { webSearch: true, configOverrides: COMMITTED },
      });
      const loop = api.addLoop(definition);
      const dialog = await openOverrides(api, loop.id, definition);
      const saved = () => harnessOptionsOf(api.loops.get(loop.id)!.draft!.definition);
      const puts = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
      const before = {
        revision: store().revision,
        saveState: store().saveState,
        puts: puts().length,
      };

      const message = `${path}: ${CODEX_CONFIG_KEY_MESSAGE}`;
      setCode('Config overrides value 1', text);
      const value = screen.getByLabelText('Config overrides value 1');
      expect(getCode('Config overrides value 1')).toBe(text);
      expect(value).toHaveAttribute('aria-invalid', 'true');
      expect(value).toHaveAccessibleDescription(expect.stringContaining(message));
      // The editor holds the text as blocking input; its draft and saved state do not change.
      expect(store().fieldErrors['node:infer']?.[VALUE_PATH]).toEqual({
        message,
        text,
        input: 'unparsed text',
      });
      expect(within(dialog).getByRole('tab', { name: /^Settings/ })).toHaveAccessibleName(
        /\b1 error\b/,
      );
      await act(() => new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS * 2)));
      expect(puts()).toHaveLength(before.puts);
      expect(store().revision).toBe(before.revision);
      expect(store().saveState).toBe(before.saveState);
      expect(harnessOptionsOf(store().definition)?.configOverrides).toEqual(COMMITTED);
      expect(saved()?.configOverrides).toEqual(COMMITTED);
      expect(getCode('Config overrides value 1')).toBe(text);

      // Another field cleared meanwhile saves without it, and with the entry's committed value.
      await user.click(
        within(within(dialog).getByRole('radiogroup', { name: 'Web search' })).getByRole('radio', {
          name: 'Not set',
        }),
      );
      await waitFor(() => expect(saved()).not.toHaveProperty('webSearch'), { timeout: 5000 });
      expect(saved()?.configOverrides).toEqual(COMMITTED);
      expect(JSON.stringify(puts().at(-1)!.body)).not.toContain('graphgoblin:unset');
      expect(getCode('Config overrides value 1')).toBe(text);
      expect(value).toHaveAttribute('aria-invalid', 'true');

      // Corrected, the whole value is saved as typed and the held input ends.
      const corrected = text.replace('"__proto__"', '"proto_flag"');
      const whole = JSON.parse(corrected) as unknown;
      setCode('Config overrides value 1', corrected);
      expect(value).not.toHaveAttribute('aria-invalid');
      expect(store().fieldErrors['node:infer']?.[VALUE_PATH]).toBeUndefined();
      await waitFor(
        () => expect(saved()?.configOverrides).toEqual({ ...COMMITTED, example: whole }),
        { timeout: 5000 },
      );
      await waitFor(() => expect(store().saveState).toBe('saved'));

      // Reopened from the server's draft, the editor shows the whole saved value.
      cleanup();
      const reloaded = api.loops.get(loop.id)!.draft!.definition;
      await openOverrides(api, loop.id, reloaded);
      expect(JSON.parse(getCode('Config overrides value 1'))).toEqual(whole);
      expect(screen.getByLabelText('Config overrides value 1')).not.toHaveAttribute('aria-invalid');
    },
    30_000,
  );
});

describe('an issue inside a committed Codex override Value in the node editor (#521)', () => {
  it('describes the owning Value, takes its issue link there, and saves once corrected', async () => {
    const api = new FakeApi();
    const overrides = { example: { previous: true }, 'example.outer': 'sibling' };
    const definition = loopWith({
      prompt: { template: 'Summarise the notes.' },
      harnessOptions: { configOverrides: overrides },
    });
    const loop = api.addLoop(definition);
    const dialog = await openOverrides(api, loop.id, definition);
    const saved = () => harnessOptionsOf(api.loops.get(loop.id)!.draft!.definition);
    const value = screen.getByLabelText('Config overrides value 1');
    const sibling = screen.getByLabelText('Config overrides value 2');

    setCode('Config overrides value 1', '{"outer":{"team docs":true}}');
    const message = `outer.team docs: ${CODEX_CONFIG_KEY_MESSAGE}`;
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(value).toHaveAccessibleDescription(message);
    expect(sibling).not.toHaveAttribute('aria-invalid');
    // A schema issue of the committed draft: no held text, and the tab counts it once.
    expect(store().fieldErrors['node:infer']).toBeUndefined();
    expect(harnessOptionsOf(store().definition)?.configOverrides).toEqual({
      ...overrides,
      example: { outer: { 'team docs': true } },
    });
    expect(within(dialog).getByRole('tab', { name: /^Settings/ })).toHaveAccessibleName(
      /\b1 error\b/,
    );

    // The issue's link, as the node's issue list follows it, reaches the owning Value.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => store().openNode('infer', { field: `config.${VALUE_PATH}.outer.team docs` }));
    await waitFor(() => expect(value).toHaveFocus());

    // Corrected, the Value is clean and the whole draft is saved.
    const corrected = { outer: { team_docs: true } };
    setCode('Config overrides value 1', JSON.stringify(corrected));
    expect(value).not.toHaveAttribute('aria-invalid');
    await waitFor(
      () => expect(saved()?.configOverrides).toEqual({ ...overrides, example: corrected }),
      { timeout: 5000 },
    );
    await waitFor(() => expect(store().saveState).toBe('saved'));
  }, 30_000);
});
