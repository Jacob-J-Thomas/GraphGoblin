import {
  LoopDefinitionSchema,
  VoicePreviewSchema,
  VOICE_NORMALIZER_COMMAND,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio, stableHash } from '@graphgoblin/domain';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { createAppClient } from '../api/context.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { isConnectionBannerClaimed } from '../components/layout/index.js';
import { useReachability } from '../lib/reachability.js';
import { voiceSetup } from '../settings/voice-client.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

/*
 * The loaded editor owns the one connection banner and shows it under its toolbar (#208); every
 * other route and editor state leaves it to the shell. jsdom has no layout, so these tests prove
 * the ownership and the DOM context: what stands before the toolbar in document order is the same
 * elements before, during and after a connection change, so nothing can push the toolbar (and the
 * Undo and Redo buttons in it) down, and exactly one banner is on screen. That the toolbar then
 * stays at the same pixels, and what a reader announces, are for independent native QA.
 */

const OFFLINE = 'You are offline';
const UNREACHABLE = 'Cannot reach the GraphGoblin API';

const connectionStatuses = () =>
  screen
    .queryAllByRole('status')
    .filter(
      (element) =>
        element.textContent?.includes(OFFLINE) || element.textContent?.includes(UNREACHABLE),
    );

/** The shell's root element: the column holding its header, notices and the routed screen. */
const shellRoot = () => document.querySelector('header.hairline-accent')!.parentElement!;
/** The editor's bar, and the frame that holds it. */
const toolbarOf = () => screen.getByTestId('history-actions').parentElement!;

/** Everything that stands before `target` in document order, ancestors excluded. */
function elementsBefore(target: Element): Element[] {
  return [...document.body.querySelectorAll('*')].filter(
    (element) =>
      element !== target &&
      !element.contains(target) &&
      Boolean(element.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}
function expectSameNodes(actual: readonly Element[], expected: readonly Element[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((element, index) => expect(element).toBe(expected[index]));
}

let onLine: MockInstance<() => boolean>;
function browserOffline(offline: boolean) {
  onLine.mockReturnValue(!offline);
  act(() => {
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
  });
}

async function openEditor(api: FakeApi, name = 'conn') {
  const loop = api.addLoop(newLoopDefinition(name));
  const view = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByTestId('history-actions');
  return { loop, view };
}

beforeEach(() => {
  onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // TanStack Query remembers the last `offline` event for the whole file: a later test's queries
  // would stay paused behind a connection the test itself restored.
  onlineManager.setOnline(true);
  useReachability.setState({ apiReachable: true, reconnecting: false });
  // Whatever happened in the test, no editor is left holding the banner.
  expect(isConnectionBannerClaimed()).toBe(false);
});

describe('a loaded editor and the connection banner', () => {
  it('shows the one banner straight under its toolbar, and the shell shows none above it', async () => {
    await openEditor(new FakeApi());
    const toolbar = toolbarOf();
    const frame = toolbar.parentElement!;
    const shell = shellRoot();
    expect(frame.parentElement).toBe(shell);
    expect(isConnectionBannerClaimed()).toBe(true);
    expect(connectionStatuses()).toHaveLength(0);
    const shellChildren = [...shell.children];
    const before = elementsBefore(toolbar);

    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    const [banner] = connectionStatuses();
    expect(banner).toHaveTextContent(OFFLINE);
    expect(banner).toHaveTextContent(
      'saving, running, and live updates resume when you reconnect.',
    );
    // Directly under the toolbar, inside the editor's frame; not a child of the shell.
    expect(banner!.parentElement).toBe(frame);
    expect(toolbar.nextElementSibling).toBe(banner);
    expect(banner!.parentElement).not.toBe(shell);
    // Nothing was added above the editor: the shell's children and everything before the toolbar
    // are the very same elements, so the toolbar has not moved in the document.
    expectSameNodes([...shell.children], shellChildren);
    expectSameNodes(elementsBefore(toolbar), before);

    browserOffline(false);
    expect(connectionStatuses()).toHaveLength(0);
    expectSameNodes([...shell.children], shellChildren);
    expectSameNodes(elementsBefore(toolbar), before);
  });

  it('keeps Undo, Redo and all that precedes them in place through a history session while offline and back', async () => {
    const user = userEvent.setup();
    await openEditor(new FakeApi());
    const toolbar = toolbarOf();
    const slot = screen.getByTestId('history-actions');
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    const before = elementsBefore(toolbar);
    const stays = () => {
      expectSameNodes(elementsBefore(toolbar), before);
      expect(toolbar.firstElementChild).toBe(slot);
      expect(screen.getByTestId('history-actions')).toBe(slot);
      expect(slot.children[0]).toBe(undo);
      expect(slot.children[1]).toBe(redo);
    };

    act(() => useEditorStore.getState().moveNode('start', { x: 40, y: 80 }));
    stays();
    browserOffline(true);
    stays();
    expect(connectionStatuses()).toHaveLength(1);
    await user.click(undo);
    expect(useEditorStore.getState().definition!.nodes[0]!.ui).toEqual({ x: 0, y: 80 });
    expect(undo).toHaveFocus();
    stays();
    await user.click(redo);
    expect(useEditorStore.getState().definition!.nodes[0]!.ui).toEqual({ x: 40, y: 80 });
    expect(redo).toHaveFocus();
    stays();
    await user.keyboard('{Control>}z{/Control}');
    expect(useEditorStore.getState().definition!.nodes[0]!.ui).toEqual({ x: 0, y: 80 });
    stays();
    browserOffline(false);
    stays();
    expect(connectionStatuses()).toHaveLength(0);
  });

  it('shows the API-unreachable wording below the toolbar after a failed save, and clears it on recovery', async () => {
    const api = new FakeApi();
    api.override('GET /healthz', () => new Response('ok'));
    await openEditor(api);
    const toolbar = toolbarOf();
    const before = elementsBefore(toolbar);
    expect(connectionStatuses()).toHaveLength(0);

    api.offline = true;
    act(() => useEditorStore.getState().moveNode('start', { x: 40, y: 80 }));
    await waitFor(() => expect(connectionStatuses()).toHaveLength(1), { timeout: 5000 });
    const [banner] = connectionStatuses();
    expect(banner).toHaveTextContent(UNREACHABLE);
    expect(banner).toHaveTextContent('resume when the API is reachable again.');
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
    expect(toolbar.nextElementSibling).toBe(banner);
    expectSameNodes(elementsBefore(toolbar), before);

    api.offline = false;
    await waitFor(() => expect(connectionStatuses()).toHaveLength(0), { timeout: 8000 });
    expectSameNodes(elementsBefore(toolbar), before);
    expect(isConnectionBannerClaimed()).toBe(true);
  }, 20_000);

  it('is not triggered by an HTTP 500: no banner anywhere, the save notice says what failed', async () => {
    const api = new FakeApi();
    api.override('PUT /loops/:id/draft', () => problem(500, 'INTERNAL', 'the store failed'));
    await openEditor(api);
    act(() => useEditorStore.getState().moveNode('start', { x: 40, y: 80 }));
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed'), {
      timeout: 5000,
    });
    expect(connectionStatuses()).toHaveLength(0);
    expect(shellRoot()).not.toHaveTextContent(UNREACHABLE);
  });
});

describe('every other state keeps the shell banner', () => {
  it('while the loop is loading, then hands the one banner to the editor once, when it loads', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('slow'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.override('GET /loops/:id', async (call) => {
      await gate;
      return api.builtIn(call);
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByText('Loading loop…');
    // The request is under way; the browser goes offline while the editor is still loading.
    await waitFor(() => expect(api.callsTo('GET', `/loops/${loop.id}`)).toHaveLength(1));
    browserOffline(true);
    expect(isConnectionBannerClaimed()).toBe(false);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
    expect(screen.queryByTestId('history-actions')).not.toBeInTheDocument();

    release();
    await screen.findByTestId('history-actions');
    expect(isConnectionBannerClaimed()).toBe(true);
    // The accepted single hand-over: now exactly one banner, inside the loaded editor.
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(toolbarOf().parentElement);
    expect(shellRoot()).toContainElement(connectionStatuses()[0]!);
  });

  it('when the loop cannot be loaded because the API cannot be reached, the shell says so', async () => {
    const api = new FakeApi();
    api.override('GET /healthz', () => new Response('ok'));
    const loop = api.addLoop(newLoopDefinition('down'));
    api.offline = true;
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument();
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
    expect(screen.queryByTestId('history-actions')).not.toBeInTheDocument();
    expect(isConnectionBannerClaimed()).toBe(false);
    // The only status is not lost to a claim that nothing holds.
    expect(screen.getByText(/The editor/)).toBeInTheDocument();
  });

  it('when the loop is not found (an error state), the shell banner stays and nothing is claimed', async () => {
    const api = new FakeApi();
    renderApp('/loops/missing/edit', api);
    await waitFor(() => expect(api.callsTo('GET', '/loops/missing')).toHaveLength(1));
    expect(await screen.findByText('Could not load loop')).toBeInTheDocument();
    expect(screen.queryByTestId('history-actions')).not.toBeInTheDocument();
    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('keeps the API key panel in the shell beside the one banner when the editor cannot open', async () => {
    const api = new FakeApi();
    api.requiredKey = 'gg_good';
    const loop = api.addLoop(newLoopDefinition('guarded'));
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('API key required')).toBeInTheDocument();
    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
    expect(shellRoot()).toContainElement(screen.getByText('API key required'));
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('keeps the banner in the shell on another route, and hands it back and forth with the editor', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('route'));
    function GoTo({ to, label }: { to: string; label: string }) {
      const navigate = useNavigate();
      return <button onClick={() => void navigate(to)}>{label}</button>;
    }
    renderWith(
      <>
        <App />
        <GoTo to="/events" label="go events" />
        <GoTo to={`/loops/${loop.id}/edit`} label="go editor" />
      </>,
      `/loops/${loop.id}/edit`,
      api,
    );
    await screen.findByTestId('history-actions');
    browserOffline(true);
    const inEditor = () => connectionStatuses()[0]!.parentElement === toolbarOf().parentElement;
    expect(connectionStatuses()).toHaveLength(1);
    expect(inEditor()).toBe(true);

    // Leaving the editor: the claim is released, and the shell shows the one banner.
    fireEvent.click(screen.getByRole('button', { name: 'go events' }));
    await screen.findByRole('heading', { name: 'Events' });
    expect(screen.queryByTestId('history-actions')).not.toBeInTheDocument();
    expect(isConnectionBannerClaimed()).toBe(false);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());

    // Entering it again: claimed once more, one banner, in the editor.
    fireEvent.click(screen.getByRole('button', { name: 'go editor' }));
    await screen.findByTestId('history-actions');
    expect(isConnectionBannerClaimed()).toBe(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(inEditor()).toBe(true);
  });

  it('is released when the editor crashes and its error boundary takes over the screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openEditor(new FakeApi());
    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(isConnectionBannerClaimed()).toBe(true);
    // A definition the editor cannot render.
    act(() => {
      const definition = useEditorStore.getState().definition!;
      useEditorStore.setState({ definition: { ...definition, nodes: undefined } as never });
    });
    await screen.findByText('This screen failed to render');
    expect(isConnectionBannerClaimed()).toBe(false);
    // The status survives the crash: the shell shows it, once.
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
  });

  it('keeps the shell banner while a voice draft is staged and the frame is inert, then hands it over', async () => {
    const source = LoopDefinitionSchema.parse(
      createSystemChatDefinition({ name: 'Customized chat', harness: 'codex' }),
    );
    const next = enableChatAudio(source, {
      id: 'chat-normalize',
      kind: 'script',
      label: 'Normalize voice',
      ui: { x: 160, y: 0 },
      config: {
        command: VOICE_NORMALIZER_COMMAND,
        args: [],
        cwd: 'workspace',
        stdin: 'thread',
        stdout: 'last-output',
      },
    });
    const api = new FakeApi();
    const loop = api.addLoop(source, { published: true });
    const preview = VoicePreviewSchema.parse({
      loopId: loop.id,
      baseHash: stableHash(source),
      configRevision: 1,
      previewHash: stableHash(next),
      definition: next,
      message: 'Review this draft.',
    });
    let fail!: () => void;
    const stage = vi.spyOn(voiceSetup, 'stage').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error('stage failed'));
        }),
    );
    const client = createAppClient('http://graphgoblin.test', api.fetch);
    render(
      <Providers client={client} queryClient={new QueryClient()}>
        <MemoryRouter
          initialEntries={[
            { pathname: `/loops/${loop.id}/edit`, state: { voicePreview: preview } },
          ]}
        >
          <App />
        </MemoryRouter>
      </Providers>,
    );
    const apply = await screen.findByRole('button', { name: 'Apply reviewed voice draft' });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(isConnectionBannerClaimed()).toBe(true);

    fireEvent.click(apply);
    await waitFor(() => expect(stage).toHaveBeenCalledOnce());
    const frame = toolbarOf().parentElement!;
    expect(frame).toHaveAttribute('inert');
    // Inert content is hidden from assistive technology, so the editor gives the banner back.
    expect(isConnectionBannerClaimed()).toBe(false);
    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(shellRoot());
    expect(connectionStatuses()[0]!.closest('[inert]')).toBeNull();

    // Staging ends (here: refused). The frame is live again and owns the one banner.
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    await waitFor(() => expect(frame).not.toHaveAttribute('inert'));
    expect(isConnectionBannerClaimed()).toBe(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(frame);
  });
});

describe('unrelated shell notices and strict mode', () => {
  it('leaves the storage and shutdown notices where they are, above the editor, beside the one banner', async () => {
    const api = new FakeApi();
    api.override('GET /system/storage', () =>
      Response.json({
        state: 'pressure',
        checkedAt: null,
        volumes: [],
        cleaning: false,
        deletedRuns: 0,
        removedFileBytes: 0,
        reusableDatabaseBytes: 0,
        pendingResources: 0,
        preservedResources: 0,
      }),
    );
    api.override('GET /system/shutdown', () =>
      Response.json({
        phase: 'awaiting-choice',
        controlToken: 'fake-awaiting-choice',
        graceMs: 300000,
        activeRunIds: [],
        unconfirmedRunIds: [],
        choices: ['wait', 'force'],
      }),
    );
    await openEditor(api);
    const storage = await screen.findByRole('status', { name: 'Storage pressure' });
    const shutdown = await screen.findByRole('region', { name: 'Gateway shutdown' });
    const toolbar = toolbarOf();
    const shell = shellRoot();
    expect(shell).toContainElement(storage);
    expect(shell).toContainElement(shutdown);
    const before = elementsBefore(toolbar);
    expect(before).toContain(storage);
    expect(before).toContain(shutdown);

    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]).not.toBe(storage);
    expect(connectionStatuses()[0]!.parentElement).toBe(toolbar.parentElement);
    // The unrelated notices are the same elements in the same place; the banner is not among them.
    expectSameNodes(elementsBefore(toolbar), before);
    expect(storage.parentElement).toBe(shell);
    expect(shutdown.parentElement).toBe(shell);
    expect(storage).not.toHaveTextContent(OFFLINE);
    expect(shutdown).not.toHaveTextContent(OFFLINE);
  });

  it('draws one banner and leaves no claim behind under strict mode', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('strict'));
    const view = renderWith(
      <StrictMode>
        <App />
      </StrictMode>,
      `/loops/${loop.id}/edit`,
      api,
    );
    await screen.findByTestId('history-actions');
    expect(isConnectionBannerClaimed()).toBe(true);
    browserOffline(true);
    expect(connectionStatuses()).toHaveLength(1);
    expect(connectionStatuses()[0]!.parentElement).toBe(toolbarOf().parentElement);
    browserOffline(false);
    expect(connectionStatuses()).toHaveLength(0);
    view.unmount();
    expect(isConnectionBannerClaimed()).toBe(false);
  });
});
