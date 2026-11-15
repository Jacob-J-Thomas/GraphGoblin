import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  claimConnectionBanner,
  isConnectionBannerClaimed,
  useConnectionBannerClaimed,
} from 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web/src/components/layout/connection-banner.ts';
import { OfflineBanner } from 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web/src/components/layout/AppShell.tsx';
import { ErrorBoundary } from 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web/src/components/ErrorBoundary.tsx';
import { EditorConnectionBanner } from 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web/src/editor/EditorConnectionBanner.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(isConnectionBannerClaimed()).toBe(false);
});

function Observer({ name }: { name: string }) {
  return <output data-testid={name}>{String(useConnectionBannerClaimed())}</output>;
}

it('late and remounted observers read an existing claim and both see its final release', () => {
  const releaseFirst = claimConnectionBanner();
  const releaseSecond = claimConnectionBanner();
  try {
    const view = render(<StrictMode><Observer name="a" /><Observer name="b" /></StrictMode>);
    expect(screen.getByTestId('a')).toHaveTextContent('true');
    expect(screen.getByTestId('b')).toHaveTextContent('true');
    act(releaseFirst);
    expect(screen.getByTestId('a')).toHaveTextContent('true');
    view.rerender(<StrictMode><Observer key="new" name="a" /><Observer name="b" /></StrictMode>);
    act(releaseFirst);
    expect(screen.getByTestId('a')).toHaveTextContent('true');
    act(releaseSecond);
    expect(screen.getByTestId('a')).toHaveTextContent('false');
    expect(screen.getByTestId('b')).toHaveTextContent('false');
  } finally {
    act(() => { releaseFirst(); releaseSecond(); });
  }
});

function Shell() {
  return <aside data-testid="shell">{useConnectionBannerClaimed() ? null : <OfflineBanner />}</aside>;
}

function MaybeEditor({ fail }: { fail: boolean }) {
  if (fail) throw new Error('independent audit render failure');
  return <main data-testid="editor"><EditorConnectionBanner /></main>;
}

function Screen({ fail }: { fail: boolean }) {
  return <StrictMode><Shell /><ErrorBoundary><MaybeEditor fail={fail} /></ErrorBoundary></StrictMode>;
}

function expectOwner(owner: 'shell' | 'editor') {
  expect(screen.getAllByText('You are offline')).toHaveLength(1);
  expect(screen.getByTestId(owner)).toContainElement(screen.getByText('You are offline'));
  expect(isConnectionBannerClaimed()).toBe(owner === 'editor');
}

it('an initial renderer failure acquires no claim, and Try again transfers exactly one banner', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const view = render(<Screen fail />);
  expectOwner('shell');
  view.rerender(<Screen fail={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expectOwner('editor');
  view.unmount();
  expect(isConnectionBannerClaimed()).toBe(false);
});

it('an existing editor releases on failure and reacquires on recovery without a stranded claim', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const view = render(<Screen fail={false} />);
  expectOwner('editor');
  view.rerender(<Screen fail />);
  expectOwner('shell');
  view.rerender(<Screen fail={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expectOwner('editor');
  view.unmount();
  expect(isConnectionBannerClaimed()).toBe(false);
});
