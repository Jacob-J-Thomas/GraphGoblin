import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem, type RecordedCall } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const SAVE_WAIT = { timeout: 4000 };
const NOTICE = 'Another loop already has this name';
const STALE = 'The draft changed on the server';

/** Two loops; the editor opens the second, whose rename will meet the first's name. */
function twoLoops() {
  const api = new FakeApi();
  const other = api.addLoop(newLoopDefinition('Nightly Triage'));
  const mine = api.addLoop({ ...newLoopDefinition('Daytime Triage'), description: 'kept' });
  const stored = () => structuredClone(api.loops.get(mine.id)!);
  return { api, other, mine, original: stored(), stored };
}

async function rename(user: ReturnType<typeof userEvent.setup>, name: string) {
  const show = screen.queryByRole('button', { name: 'Show loop settings' });
  if (show) await user.click(show);
  const field = screen.getByRole('textbox', { name: 'Name' });
  await user.clear(field);
  await user.type(field, name);
  return field;
}

const saveState = () => screen.getByTestId('save-state');

/** The loop name a recorded draft save sent. */
const sentName = (call: RecordedCall) =>
  (call.body as { definition: { name: string } }).definition.name;

/** Over the contract's 4,000-character limit for a description: the draft fails its schema. */
const TOO_LONG = 'd'.repeat(4001);

describe('renaming to another loop’s name (#209)', () => {
  it('keeps the authored name on the device and the server copy intact, and holds saves', async () => {
    const user = userEvent.setup();
    const { api, mine, original, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    const field = await rename(user, ' nightly  TRIAGE ');

    const notice = (await screen.findByText(NOTICE, undefined, SAVE_WAIT)).closest('[role]')!;
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('The name “nightly TRIAGE” matches another loop’s name');
    expect(notice).toHaveTextContent('letter case or spacing');
    // It says where the edits are only as the device write has answered.
    await waitFor(() => expect(notice).toHaveTextContent('Your changes are kept on this device'));
    expect(screen.queryByText(STALE)).toBeNull();
    expect(saveState()).toHaveTextContent('Not saved: name in use');
    expect(field).toHaveValue(' nightly  TRIAGE ');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining('letter case or spacing'));

    // The server keeps the loop's identity, name and draft; the device keeps the authored text.
    expect(stored()).toEqual(original);
    await waitFor(async () =>
      expect(await loadLocalDraft(mine.id)).toMatchObject({
        synced: false,
        definition: { name: ' nightly  TRIAGE ' },
      }),
    );

    // Further edits stay on the device while the refused name is unchanged: no request.
    const puts = api.callsTo('PUT', `/loops/${mine.id}/draft`).length;
    act(() => useEditorStore.getState().updateMeta({ description: 'edited while refused' }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(api.callsTo('PUT', `/loops/${mine.id}/draft`)).toHaveLength(puts);
    expect(saveState()).toHaveTextContent('Not saved: name in use');
    expect(stored()).toEqual(original);
    await waitFor(async () =>
      expect((await loadLocalDraft(mine.id))?.definition.description).toBe('edited while refused'),
    );

    // Publish says why instead of publishing either name.
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText(/choose a different name before publishing/),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/loops/${mine.id}/publish`)).toHaveLength(0);
  });

  it('takes the suggestion as an undoable rename and saves it under the same loop id', async () => {
    const user = userEvent.setup();
    const { api, mine, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    await rename(user, 'nightly triage');
    await screen.findByText(NOTICE, undefined, SAVE_WAIT);

    await user.click(screen.getByRole('button', { name: 'Use “nightly triage copy”' }));
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(screen.queryByText(NOTICE)).toBeNull();
    await waitFor(() => expect(saveState()).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid');
    expect(stored().loop).toMatchObject({ id: mine.id, name: 'nightly triage copy' });
    expect(stored().draft?.definition).toMatchObject({
      name: 'nightly triage copy',
      description: 'kept',
    });
    // The suggestion was one ordinary edit: Undo restores the refused text, which is held again.
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('nightly triage');
  });

  it('opens and focuses the Name field from the notice, and Try again sends the name once', async () => {
    const user = userEvent.setup();
    const { api, other, mine, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    await rename(user, 'NIGHTLY TRIAGE');
    await screen.findByText(NOTICE, undefined, SAVE_WAIT);
    await user.click(screen.getByRole('button', { name: 'Hide loop settings' }));

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    const field = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Hide loop settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const puts = () => api.callsTo('PUT', `/loops/${mine.id}/draft`).length;
    const before = puts();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(puts()).toBe(before + 1), SAVE_WAIT);
    expect(await screen.findByText('It was still in use when tried again.')).toBeInTheDocument();
    expect(saveState()).toHaveTextContent('Not saved: name in use');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts()).toBe(before + 1);

    // The other loop is renamed elsewhere; a deliberate Try again now keeps the authored name.
    api.saveDraftElsewhere(other.id, newLoopDefinition('Nightly Triage (old)'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(stored().loop).toMatchObject({ id: mine.id, name: 'NIGHTLY TRIAGE' });
  });

  it('treats a stale draft as a draft conflict first, then refuses the name on overwrite', async () => {
    const user = userEvent.setup();
    const { api, mine, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    api.saveDraftElsewhere(mine.id, {
      ...newLoopDefinition('Daytime Triage'),
      description: 'theirs',
    });
    await rename(user, 'Nightly  Triage');

    expect(await screen.findByText(STALE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(saveState()).toHaveTextContent('Draft changed elsewhere');
    const theirs = stored();

    await user.click(screen.getByRole('button', { name: 'Overwrite with this copy' }));
    expect(await screen.findByText(NOTICE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(stored()).toEqual(theirs);
    expect(useEditorStore.getState().definition?.name).toBe('Nightly  Triage');
  });

  it('shows the notice inside the node dialog without Edit name', async () => {
    const user = userEvent.setup();
    const { api, mine } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    act(() => {
      useEditorStore.getState().updateMeta({ name: 'nightly triage' });
      useEditorStore.getState().openNode('start');
    });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(NOTICE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Close this dialog to edit the name in Loop settings.');
    expect(within(dialog).queryByRole('button', { name: 'Edit name' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Use “nightly triage copy”' }));
    await waitFor(() => expect(within(dialog).queryByText(NOTICE)).toBeNull(), SAVE_WAIT);
    // The page behind the modal is inert, so focus stays in the dialog, on its title.
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: /^Edit trigger start$/ })).toHaveFocus(),
    );
  });

  it('clears the guidance on leaving without saving the refused name, and asks again on return', async () => {
    const user = userEvent.setup();
    const { api, mine, original, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    await rename(user, 'Nightly Triage');
    await screen.findByText(NOTICE, undefined, SAVE_WAIT);
    // An edit inside the debounce window, then leave: the refused name is not sent on unmount.
    act(() => useEditorStore.getState().updateMeta({ description: 'typed before leaving' }));
    const puts = api.callsTo('PUT', `/loops/${mine.id}/draft`).length;
    // The navigation link and the toolbar's breadcrumb both lead to Loops.
    await user.click(screen.getAllByRole('link', { name: 'Loops' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Loops' })).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(api.callsTo('PUT', `/loops/${mine.id}/draft`)).toHaveLength(puts);
    expect(stored()).toEqual(original);
    expect(await loadLocalDraft(mine.id)).toMatchObject({
      synced: false,
      definition: { name: 'Nightly Triage', description: 'typed before leaving' },
    });

    await user.click(screen.getByRole('link', { name: 'Edit Daytime Triage' }));
    expect(await screen.findByText(NOTICE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(useEditorStore.getState().definition).toMatchObject({
      name: 'Nightly Triage',
      description: 'typed before leaving',
    });
    expect(stored()).toEqual(original);
  });
});

describe('Try again is one deliberate save of the refused name (#209)', () => {
  /** Rename to the other loop's name and wait for the refusal; returns the save counter. */
  async function refused(user: ReturnType<typeof userEvent.setup>, api: FakeApi, loopId: string) {
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    const field = await rename(user, 'Nightly Triage');
    await screen.findByText(NOTICE, undefined, SAVE_WAIT);
    const puts = () => api.callsTo('PUT', `/loops/${loopId}/draft`);
    return { field, puts, before: puts().length };
  }

  async function pasteInvalidDescription(user: ReturnType<typeof userEvent.setup>) {
    const description = screen.getByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.paste(TOO_LONG);
    await waitFor(
      () => expect(saveState()).toHaveTextContent('Saved on this device only'),
      SAVE_WAIT,
    );
    return description;
  }

  it('settles a Try again that invalid companion text stopped, sending nothing', async () => {
    const user = userEvent.setup();
    const { api, mine, original, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    const { puts, before } = await refused(user, api, mine.id);
    await pasteInvalidDescription(user);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    // The attempt ends at the schema check: the action is offered again, not left busy.
    await waitFor(() => {
      const retry = screen.getByRole('button', { name: 'Try again' });
      expect(retry).not.toHaveAttribute('aria-busy');
      expect(retry).not.toHaveAttribute('aria-disabled');
    });
    expect(saveState()).toHaveTextContent('Saved on this device only');
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(puts()).toHaveLength(before);
    expect(stored()).toEqual(original);
    await waitFor(async () =>
      expect(await loadLocalDraft(mine.id)).toMatchObject({
        synced: false,
        definition: { name: 'Nightly Triage', description: TOO_LONG },
      }),
    );
  });

  it('sends nothing when only the companion text is repaired, then once on a fresh Try again', async () => {
    const user = userEvent.setup();
    const { api, other, mine, original, stored } = twoLoops();
    renderApp(`/loops/${mine.id}/edit`, api);
    const { puts, before } = await refused(user, api, mine.id);
    const description = await pasteInvalidDescription(user);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The other loop is renamed meanwhile, so any save of the name would now be accepted.
    api.saveDraftElsewhere(other.id, newLoopDefinition('Nightly Triage (old)'));
    await user.clear(description);
    await user.type(description, 'repaired');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts()).toHaveLength(before);
    expect(stored()).toEqual(original);
    expect(saveState()).toHaveTextContent('Not saved: name in use');
    expect(screen.getByText(NOTICE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(
      puts()
        .slice(before)
        .map((call) => call.body),
    ).toMatchObject([{ definition: { name: 'Nightly Triage', description: 'repaired' } }]);
    expect(stored().loop).toMatchObject({ id: mine.id, name: 'Nightly Triage' });
    expect(stored().draft?.definition.description).toBe('repaired');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts()).toHaveLength(before + 1);
  });

  /**
   * After the refusal, rename to an allowed name whose ordinary save is held in flight, go back
   * to the refused name with Undo, and choose Try again: it queues behind the held save.
   */
  async function retryQueuedBehindHeldSave(user: ReturnType<typeof userEvent.setup>) {
    const { api, other, mine, stored } = twoLoops();
    let heldCall: RecordedCall | undefined;
    let answer!: (response: Response | Promise<Response>) => void;
    api.override('PUT /loops/:id/draft', (call) => {
      if (sentName(call) !== 'Daytime B') return api.builtIn(call);
      heldCall = call;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    });
    renderApp(`/loops/${mine.id}/edit`, api);
    const { field, puts } = await refused(user, api, mine.id);
    // A new undo step, rather than more typing merged into the refused name's.
    act(() => useEditorStore.getState().closeStep());
    await user.clear(field);
    await user.type(field, 'Daytime B');
    await waitFor(() => expect(heldCall).toBeDefined(), SAVE_WAIT);
    const before = puts().length;

    // Undo remounts the settings form, so the field is found again.
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Nightly Triage');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    return { api, other, mine, stored, puts, before, heldCall: heldCall!, answer };
  }

  it('keeps a Try again queued behind an ordinary save that then fails', async () => {
    const user = userEvent.setup();
    const { api, other, mine, stored, puts, before, answer } =
      await retryQueuedBehindHeldSave(user);
    api.saveDraftElsewhere(other.id, newLoopDefinition('Nightly Triage (old)'));
    await act(() => Promise.resolve(answer(problem(503, 'UNAVAILABLE', 'The store is busy.'))));

    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(puts().slice(before).map(sentName)).toEqual(['Nightly Triage']);
    expect(stored().loop).toMatchObject({ id: mine.id, name: 'Nightly Triage' });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('lets a stale draft stop a Try again queued behind the failing save', async () => {
    const user = userEvent.setup();
    const { api, mine, stored, puts, before, heldCall, answer } =
      await retryQueuedBehindHeldSave(user);
    api.saveDraftElsewhere(mine.id, {
      ...newLoopDefinition('Daytime Triage'),
      description: 'theirs',
    });
    const theirs = stored();
    await act(() => Promise.resolve(answer(api.builtIn(heldCall))));

    expect(await screen.findByText(STALE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(saveState()).toHaveTextContent('Draft changed elsewhere');
    expect(screen.queryByText(NOTICE)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts()).toHaveLength(before);
    expect(stored()).toEqual(theirs);
    expect(useEditorStore.getState().definition?.name).toBe('Nightly Triage');
  });
});
