import { CODEX_CONFIG_KEY_MESSAGE, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi, type RecordedCall } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { newLoopDefinition } from './model.js';
import { HELD_INPUT_LABEL } from './save-status.js';
import { useEditorStore } from './store.js';
import { AUTOSAVE_DELAY_MS } from './useAutosave.js';

/**
 * Input a field holds apart from the draft, beside the draft's own save state (#526), with a
 * declared variable's JSON Schema that has an own member "__proto__" as the held input (#527): the
 * real editor, its Variables form, autosave, the fake API's draft saves and a reload.
 */

const SAVE_WAIT = { timeout: 6000 };
const store = () => useEditorStore.getState();
const saveState = () => screen.getByTestId('save-state');
const draftState = () => screen.queryByTestId('draft-state');
const heldState = () => screen.queryByTestId('held-input-state');
const pageAnnouncement = () => screen.getByTestId('held-input-announcement-page');

const TOPIC = {
  type: 'object',
  description: 'The topic',
  properties: { name: { type: 'string' } },
};
const OTHER = { type: 'number', minimum: 0 };
const HELD =
  '{"type":"object","description":"The topic","properties":{"__proto__":{"type":"string"},"name":{"type":"string"}}}';
const MEMBER_MESSAGE =
  'properties.__proto__: This member name cannot be saved. Rename or remove it.';

beforeEach(() => localStorage.setItem('graphgoblin-loop-panel', 'expanded'));

function withVariables(): { api: FakeApi; loopId: string; definition: LoopDefinitionInput } {
  const api = new FakeApi();
  const definition: LoopDefinitionInput = {
    ...newLoopDefinition('held input'),
    description: 'kept',
    variables: { topic: TOPIC, other: OTHER },
  };
  return { api, loopId: api.addLoop(definition).id, definition };
}

async function openEditor(api: FakeApi, loopId: string) {
  renderApp(`/loops/${loopId}/edit`, api);
  await screen.findByRole('heading', { name: 'held input' }, SAVE_WAIT);
  await screen.findByRole('form', { name: 'Variables form' });
  await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
}

const puts = (api: FakeApi, loopId: string) => api.callsTo('PUT', `/loops/${loopId}/draft`);
const sent = (call: RecordedCall) =>
  (call.body as { definition: LoopDefinitionInput & Record<string, unknown> }).definition;
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS * 2)));

describe('held field input beside the complete draft (#526, #527)', () => {
  it('keeps a held Variables Value in this window, saves the rest without it, and saves it whole once renamed', async () => {
    const { api, loopId, definition } = withVariables();
    await openEditor(api, loopId);
    const status = saveState();
    const region = pageAnnouncement();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
    expect(heldState()).toBeNull();
    const before = { puts: puts(api, loopId).length, revision: store().revision };

    // Held: the Value keeps the text and names the member, the draft keeps the last complete schema.
    setCode('Variables value 1', HELD);
    const value = screen.getByLabelText('Variables value 1');
    expect(getCode('Variables value 1')).toBe(HELD);
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(value).toHaveAccessibleDescription(expect.stringContaining(MEMBER_MESSAGE));
    expect(store().fieldErrors['variables']).toEqual({
      'variables.topic': { message: MEMBER_MESSAGE, text: HELD, input: 'unparsed text' },
    });
    expect(store().definition?.variables).toEqual({ topic: TOPIC, other: OTHER });
    expect(store().revision).toBe(before.revision);
    expect(store().saveState).toBe('saved');
    // The indicator keeps the draft's state and adds where the field input is; no "All changes".
    expect(saveState()).toBe(status);
    expect(draftState()).toHaveTextContent(/^Draft saved$/);
    expect(heldState()).toHaveTextContent(HELD_INPUT_LABEL);
    expect(saveState()).not.toHaveTextContent('All changes saved');
    // Announced once, politely, in the page's region.
    expect(pageAnnouncement()).toBe(region);
    expect(region).toHaveTextContent(HELD_INPUT_LABEL);
    const announced = region.firstChild;
    // No narrowed value was written.
    await settle();
    expect(puts(api, loopId)).toHaveLength(before.puts);
    expect(api.loops.get(loopId)!.draft!.definition.variables).toEqual({
      topic: TOPIC,
      other: OTHER,
    });

    // Typing on in the held field says nothing new.
    const still = HELD.replace('"name"', '"title"');
    setCode('Variables value 1', still);
    expect(store().fieldErrors['variables']?.['variables.topic']?.text).toBe(still);
    expect(region.firstChild).toBe(announced);
    expect(region).toHaveTextContent(HELD_INPUT_LABEL);

    // A valid neighbouring edit saves the complete draft without the held text.
    setCode('Variables value 2', '{"type":"integer"}');
    await waitFor(() => expect(puts(api, loopId)).toHaveLength(before.puts + 1), SAVE_WAIT);
    const neighbour = sent(puts(api, loopId).at(-1)!);
    expect(neighbour.variables).toEqual({ topic: TOPIC, other: { type: 'integer' } });
    expect(JSON.stringify(neighbour)).not.toContain('__proto__');
    expect(JSON.stringify(neighbour)).not.toContain('"title"');
    expect(neighbour.description).toBe('kept');
    await waitFor(() => expect(store().saveState).toBe('saved'), SAVE_WAIT);
    expect(saveState()).toBe(status);
    expect(draftState()).toHaveTextContent(/^Draft saved$/);
    expect(heldState()).toHaveTextContent(HELD_INPUT_LABEL);
    expect(region.firstChild).toBe(announced);

    // Renamed, the hold ends: the whole schema is saved exactly, and the indicator says all is.
    const renamed = still.replace('"__proto__"', '"proto_member"');
    setCode('Variables value 1', renamed);
    expect(value).not.toHaveAttribute('aria-invalid');
    expect(store().fieldErrors).toEqual({});
    expect(heldState()).toBeNull();
    expect(region).toHaveTextContent('');
    await waitFor(() => expect(puts(api, loopId)).toHaveLength(before.puts + 2), SAVE_WAIT);
    const whole = sent(puts(api, loopId).at(-1)!);
    expect(JSON.stringify(whole.variables)).toBe(
      JSON.stringify({ topic: JSON.parse(renamed) as unknown, other: { type: 'integer' } }),
    );
    expect(whole).toMatchObject({ name: definition.name, description: 'kept' });
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(saveState()).toBe(status);

    // Reloaded, the editor shows the saved schema, every sibling field with it.
    cleanup();
    await openEditor(api, loopId);
    expect(JSON.parse(getCode('Variables value 1'))).toEqual(JSON.parse(renamed));
    expect(JSON.parse(getCode('Variables value 2'))).toEqual({ type: 'integer' });
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('kept');
    expect(heldState()).toBeNull();
  }, 40_000);

  it('ends the window-only claim on Discard, and a reload restores only the complete draft', async () => {
    const user = userEvent.setup();
    const { api, loopId } = withVariables();
    await openEditor(api, loopId);
    const status = saveState();
    const region = pageAnnouncement();

    setCode('Variables value 1', HELD);
    expect(heldState()).toHaveTextContent(HELD_INPUT_LABEL);
    expect(region).toHaveTextContent(HELD_INPUT_LABEL);
    await user.click(screen.getByRole('button', { name: 'Discard the unparsed text' }));
    expect(heldState()).toBeNull();
    expect(region).toHaveTextContent('');
    expect(saveState()).toBe(status);
    expect(saveState()).toHaveTextContent('All changes saved');
    expect(screen.getByLabelText('Variables value 1')).toHaveFocus();
    expect(JSON.parse(getCode('Variables value 1'))).toEqual(TOPIC);

    // Held again, then the page reloads: only the complete draft comes back.
    setCode('Variables value 1', '{broken');
    expect(heldState()).toHaveTextContent(HELD_INPUT_LABEL);
    expect(region).toHaveTextContent(HELD_INPUT_LABEL);
    await settle();
    cleanup();
    await openEditor(api, loopId);
    expect(JSON.parse(getCode('Variables value 1'))).toEqual(TOPIC);
    expect(screen.getByLabelText('Variables value 1')).not.toHaveAttribute('aria-invalid');
    expect(store().fieldErrors).toEqual({});
    expect(heldState()).toBeNull();
    expect(pageAnnouncement()).toHaveTextContent('');
  }, 30_000);

  it('announces held input in the node dialog, and passive JSON diagnostics claim nothing (#522)', async () => {
    const api = new FakeApi();
    const loopId = api.addLoop({
      ...newLoopDefinition('held input'),
      nodes: [
        ...newLoopDefinition('held input').nodes,
        {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            prompt: { template: 'Summarise the notes.' },
            harnessOptions: { configOverrides: { example: { previous: true } } },
          },
        },
      ],
    }).id;
    const user = userEvent.setup();
    renderApp(`/loops/${loopId}/edit`, api);
    await screen.findByRole('heading', { name: 'held input' }, SAVE_WAIT);
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    const status = saveState();
    act(() => store().openNode('infer'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit inference infer' });
    openAdvanced(dialog);
    const dialogRegion = within(dialog).getByTestId('held-input-announcement-dialog');
    expect(dialogRegion).toHaveAttribute('aria-live', 'polite');
    expect(dialogRegion).toHaveClass('sr-only');
    expect(dialogRegion).toHaveTextContent('');

    // Held input in the modal dialog is announced there, not on the page behind it.
    setCode('Config overrides value 1', '{broken');
    expect(dialogRegion).toHaveTextContent(HELD_INPUT_LABEL);
    expect(pageAnnouncement()).toHaveTextContent('');
    expect(heldState()).toHaveTextContent(HELD_INPUT_LABEL);
    expect(draftState()).toHaveTextContent(/^Draft saved$/);
    const announced = dialogRegion.firstChild;
    setCode('Config overrides value 1', '{broken again');
    expect(dialogRegion.firstChild).toBe(announced);
    await user.click(within(dialog).getByRole('button', { name: 'Discard the unparsed text' }));
    expect(dialogRegion).toHaveTextContent('');
    expect(heldState()).toBeNull();
    expect(saveState()).toBe(status);

    // A committed nested refusal shows on its Value (#521) and, opened as JSON, passively: neither
    // is held input, so nothing is kept in this window only and nothing is announced.
    setCode('Config overrides value 1', '{"outer":{"team docs":true}}');
    await user.click(
      within(dialog).getByRole('button', { name: 'Edit as JSON: Config overrides' }),
    );
    const refusal = `example.outer.team docs: ${CODEX_CONFIG_KEY_MESSAGE}`;
    expect(within(dialog).getByText(refusal)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Discard the unparsed text' })).toBeNull();
    expect(store().fieldErrors).toEqual({});
    expect(heldState()).toBeNull();
    expect(saveState()).not.toHaveTextContent(HELD_INPUT_LABEL);
    expect(dialogRegion).toHaveTextContent('');
    expect(pageAnnouncement()).toHaveTextContent('');
    await waitFor(() => expect(store().saveState).toBe('invalid'), SAVE_WAIT);
    expect(heldState()).toBeNull();
  }, 30_000);
});
