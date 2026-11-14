import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimConnectionBanner,
  isConnectionBannerClaimed,
  useConnectionBannerClaim,
  useConnectionBannerClaimed,
} from './index.js';

function Claimant({ label }: { label: string }) {
  useConnectionBannerClaim();
  return <p>{label}</p>;
}

/** Shows what the shell would see: whether a screen holds the banner. */
function Observer({ seen }: { seen: boolean[] }) {
  const claimed = useConnectionBannerClaimed();
  seen.push(claimed);
  return <output data-testid="claimed">{String(claimed)}</output>;
}

afterEach(() => {
  // The claims are module state shared by every test of this file: none may outlive its test.
  cleanup();
  expect(isConnectionBannerClaimed()).toBe(false);
});

describe('connection banner claims', () => {
  it('is claimed while any claim is held, and a repeated release releases nothing else', () => {
    expect(isConnectionBannerClaimed()).toBe(false);
    const first = claimConnectionBanner();
    const second = claimConnectionBanner();
    expect(isConnectionBannerClaimed()).toBe(true);
    first();
    first();
    // The first claim is gone however often it is released; the second is still held.
    expect(isConnectionBannerClaimed()).toBe(true);
    second();
    expect(isConnectionBannerClaimed()).toBe(false);
    second();
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('tells a subscribed component when the claim starts and ends, and stops after it unmounts', () => {
    const seen: boolean[] = [];
    const view = render(<Observer seen={seen} />);
    expect(view.getByTestId('claimed')).toHaveTextContent('false');
    let release!: () => void;
    act(() => {
      release = claimConnectionBanner();
    });
    expect(view.getByTestId('claimed')).toHaveTextContent('true');
    act(() => release());
    expect(view.getByTestId('claimed')).toHaveTextContent('false');
    view.unmount();
    const rendered = seen.length;
    // A claim after the observer left reaches nobody, and does not throw.
    const late = claimConnectionBanner();
    late();
    expect(seen).toHaveLength(rendered);
  });

  it('holds one claim per mounted claimant and releases each on unmount', () => {
    const view = renderHook(useConnectionBannerClaimed);
    expect(view.result.current).toBe(false);
    const a = render(<Claimant label="a" />);
    const b = render(<Claimant label="b" />);
    expect(view.result.current).toBe(true);
    a.unmount();
    expect(view.result.current).toBe(true);
    b.unmount();
    expect(view.result.current).toBe(false);
  });

  it('survives strict mode replaying the effect: one live claim, released by unmount', () => {
    const view = render(
      <StrictMode>
        <Claimant label="strict" />
      </StrictMode>,
    );
    expect(isConnectionBannerClaimed()).toBe(true);
    // Had the replayed first claim leaked, the count would stay positive after this.
    view.unmount();
    expect(isConnectionBannerClaimed()).toBe(false);
  });

  it('keeps the claim across one claimant replacing another in the same commit', () => {
    function Swap() {
      const [key, setKey] = useState('a');
      return (
        <>
          <button onClick={() => setKey('b')}>swap</button>
          <Claimant key={key} label={key} />
        </>
      );
    }
    const seen: boolean[] = [];
    const view = render(
      <>
        <Observer seen={seen} />
        <Swap />
      </>,
    );
    expect(view.getByTestId('claimed')).toHaveTextContent('true');
    seen.length = 0;
    act(() => view.getByRole('button', { name: 'swap' }).click());
    expect(view.getByText('b')).toBeInTheDocument();
    expect(view.getByTestId('claimed')).toHaveTextContent('true');
    // The shell never rendered an unclaimed moment, so it cannot show its own banner for a frame.
    expect(seen).not.toContain(false);
    view.unmount();
  });
});
