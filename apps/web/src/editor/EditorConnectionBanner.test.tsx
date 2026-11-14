import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import {
  isConnectionBannerClaimed,
  OfflineBanner,
  useConnectionBannerClaimed,
} from '../components/layout/index.js';
import { markApiReachable, markApiUnreachable, useReachability } from '../lib/reachability.js';
import { EditorConnectionBanner } from './EditorConnectionBanner.js';

const OFFLINE = 'You are offline';
const UNREACHABLE = 'Cannot reach the GraphGoblin API';

/** The connection banners on screen (the editor's own alerts are `role="status"` too). */
const banners = () =>
  screen
    .queryAllByRole('status')
    .filter(
      (element) =>
        element.textContent?.includes(OFFLINE) || element.textContent?.includes(UNREACHABLE),
    );

let onLine: MockInstance<() => boolean>;
function browserOffline(offline: boolean) {
  onLine.mockReturnValue(!offline);
  act(() => {
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
  });
}

beforeEach(() => {
  onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReachability.setState({ apiReachable: true, reconnecting: false });
  // The claim is module state: no test may leave it held.
  expect(isConnectionBannerClaimed()).toBe(false);
});

describe('the loaded editor’s connection banner', () => {
  it('claims the banner while mounted and draws nothing while the connection is fine', () => {
    const view = render(<EditorConnectionBanner />);
    expect(isConnectionBannerClaimed()).toBe(true);
    expect(banners()).toHaveLength(0);
    view.unmount();
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('says exactly what the shell banner says, for browser offline and for an unreachable API', () => {
    render(<EditorConnectionBanner />);
    browserOffline(true);
    const [offline] = banners();
    expect(banners()).toHaveLength(1);
    expect(offline).toHaveTextContent(
      'You are offline' +
        'The app keeps working with what it has; saving, running, and live updates resume when you reconnect.',
    );
    // The shell's own component for the same status renders the same text and markup.
    const shell = render(<OfflineBanner />);
    expect(shell.container.firstElementChild!.outerHTML).toBe(offline!.outerHTML);
    shell.unmount();

    // The browser is online again but the API cannot be reached: the other wording, one banner.
    browserOffline(false);
    act(() => markApiUnreachable());
    const [unreachable] = banners();
    expect(banners()).toHaveLength(1);
    expect(unreachable).toHaveTextContent(
      'Cannot reach the GraphGoblin API' +
        'The app keeps working with what it has; saving, running, and live updates resume when the API is reachable again.',
    );
    const shellApi = render(<OfflineBanner apiUnreachable />);
    expect(shellApi.container.firstElementChild!.outerHTML).toBe(unreachable!.outerHTML);
    shellApi.unmount();
  });

  it('reports the browser offline before the API unreachable, and clears on recovery', () => {
    render(<EditorConnectionBanner />);
    act(() => markApiUnreachable());
    browserOffline(true);
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveTextContent(OFFLINE);
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
    browserOffline(false);
    expect(banners()[0]).toHaveTextContent(UNREACHABLE);
    act(() => markApiReachable());
    expect(banners()).toHaveLength(0);
    // The claim does not depend on there being something to say.
    expect(isConnectionBannerClaimed()).toBe(true);
  });

  it('releases the claim when it unmounts with a banner showing', () => {
    browserOffline(true);
    const view = render(<EditorConnectionBanner />);
    expect(banners()).toHaveLength(1);
    expect(isConnectionBannerClaimed()).toBe(true);
    view.unmount();
    expect(banners()).toHaveLength(0);
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('draws one banner and leaves one claim under strict mode', () => {
    browserOffline(true);
    const view = render(
      <StrictMode>
        <EditorConnectionBanner />
      </StrictMode>,
    );
    expect(banners()).toHaveLength(1);
    expect(isConnectionBannerClaimed()).toBe(true);
    view.unmount();
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('releases the claim when a failed render is caught by the screen’s error boundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    browserOffline(true);
    function Bomb({ armed }: { armed: boolean }) {
      if (armed) throw new Error('canvas failed');
      return null;
    }
    function Screen() {
      const [armed, setArmed] = useState(false);
      return (
        <ErrorBoundary>
          <button onClick={() => setArmed(true)}>break</button>
          <EditorConnectionBanner />
          <Bomb armed={armed} />
        </ErrorBoundary>
      );
    }
    const seen: boolean[] = [];
    function Shell() {
      const claimed = useConnectionBannerClaimed();
      seen.push(claimed);
      // What the app shell does: it shows its own banner when no screen holds the claim.
      return claimed ? null : <OfflineBanner />;
    }
    render(
      <>
        <Shell />
        <Screen />
      </>,
    );
    expect(banners()).toHaveLength(1);
    expect(isConnectionBannerClaimed()).toBe(true);
    act(() => screen.getByRole('button', { name: 'break' }).click());
    expect(screen.getByText('This screen failed to render')).toBeInTheDocument();
    // The failed screen no longer holds the claim, so the status is not lost: the shell shows it.
    expect(isConnectionBannerClaimed()).toBe(false);
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveTextContent(OFFLINE);
  });
});

describe('claims across routes', () => {
  function EditorScreen() {
    const { loopId } = useParams();
    return (
      <section aria-label={`editor ${loopId}`}>
        <EditorConnectionBanner key={loopId} />
      </section>
    );
  }
  function Links() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => void navigate('/loops/a/edit')}>editor a</button>
        <button onClick={() => void navigate('/loops/b/edit')}>editor b</button>
        <button onClick={() => void navigate('/loops')}>loops</button>
      </>
    );
  }
  function App() {
    const claimed = useConnectionBannerClaimed();
    return (
      <>
        <output data-testid="claimed">{String(claimed)}</output>
        {/* The shell shows the banner exactly when no screen has claimed it. */}
        {claimed ? null : <OfflineBanner />}
        <Links />
        <Routes>
          <Route path="/loops/:loopId/edit" element={<EditorScreen />} />
          <Route path="*" element={<p>other screen</p>} />
        </Routes>
      </>
    );
  }

  it('moves the one banner between the shell and the editor as the route enters and leaves it', async () => {
    const user = userEvent.setup();
    browserOffline(true);
    render(
      <MemoryRouter initialEntries={['/loops']}>
        <App />
      </MemoryRouter>,
    );
    // Another route: the shell owns it.
    expect(screen.getByTestId('claimed')).toHaveTextContent('false');
    expect(banners()).toHaveLength(1);
    expect(banners()[0]!.closest('section')).toBeNull();

    // Entering a loaded editor: the editor owns it, still exactly one.
    await user.click(screen.getByRole('button', { name: 'editor a' }));
    expect(screen.getByTestId('claimed')).toHaveTextContent('true');
    expect(banners()).toHaveLength(1);
    expect(banners()[0]!.closest('section')).toHaveAccessibleName('editor a');

    // Another loop's editor replaces the first: the claim never lapses between them.
    await user.click(screen.getByRole('button', { name: 'editor b' }));
    expect(screen.getByTestId('claimed')).toHaveTextContent('true');
    expect(banners()).toHaveLength(1);
    expect(banners()[0]!.closest('section')).toHaveAccessibleName('editor b');

    // Leaving it: back to the shell, and again on re-entry.
    await user.click(screen.getByRole('button', { name: 'loops' }));
    expect(screen.getByTestId('claimed')).toHaveTextContent('false');
    expect(banners()).toHaveLength(1);
    expect(banners()[0]!.closest('section')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'editor a' }));
    expect(screen.getByTestId('claimed')).toHaveTextContent('true');
    expect(banners()).toHaveLength(1);
    expect(banners()[0]!.closest('section')).toHaveAccessibleName('editor a');
    cleanup();
    expect(isConnectionBannerClaimed()).toBe(false);
  });
});
