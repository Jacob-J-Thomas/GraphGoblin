import { expect, it, vi } from 'vitest';
import { ShutdownSignals, SHUTDOWN_SIGNAL_COALESCE_MS } from './shutdown-signals.js';

it('one foreground SIGINT and pnpm forwarding drain once; deliberate later signals force', () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn();
    let stopping = false;
    const signals = new ShutdownSignals(
      (action) => {
        request(action);
        stopping = true;
      },
      () => stopping,
    );
    signals.receive();
    vi.advanceTimersByTime(SHUTDOWN_SIGNAL_COALESCE_MS - 1);
    signals.receive();
    expect(request.mock.calls).toEqual([['drain']]);
    vi.advanceTimersByTime(1);
    signals.receive();
    expect(request.mock.calls).toEqual([['drain'], ['force']]);
    signals.receive();
    expect(request.mock.calls).toEqual([['drain'], ['force']]);
    vi.advanceTimersByTime(SHUTDOWN_SIGNAL_COALESCE_MS);
    signals.receive();
    expect(request.mock.calls).toEqual([['drain'], ['force'], ['force']]);
  } finally {
    vi.useRealTimers();
  }
});

it('a signal after an API-initiated stop explicitly forces, while its forwarded duplicate is ignored', () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn();
    const signals = new ShutdownSignals(request, () => true);
    signals.receive();
    signals.receive();
    expect(request.mock.calls).toEqual([['force']]);
    vi.advanceTimersByTime(SHUTDOWN_SIGNAL_COALESCE_MS);
    signals.receive();
    expect(request.mock.calls).toEqual([['force'], ['force']]);
  } finally {
    vi.useRealTimers();
  }
});
