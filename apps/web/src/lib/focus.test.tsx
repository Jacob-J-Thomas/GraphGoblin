import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { focusFallback, restoreFocusAfterRemoval } from './focus.js';

describe('focusFallback', () => {
  it('preserves an existing tabindex', () => {
    render(<div data-testid="target" tabIndex={3} />);
    const target = screen.getByTestId('target');

    focusFallback(target);

    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('tabindex', '3');
  });

  it('removes its temporary tabindex on blur', () => {
    render(
      <>
        <div data-testid="target" />
        <button>Next</button>
      </>,
    );
    const target = screen.getByTestId('target');

    focusFallback(target);
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('tabindex', '-1');

    screen.getByRole('button', { name: 'Next' }).focus();
    expect(target).not.toHaveAttribute('tabindex');
  });

  it('restores the tabindex immediately when focus fails', () => {
    render(<div data-testid="target" />);
    const target = screen.getByTestId('target');
    vi.spyOn(target, 'focus').mockImplementation(() => undefined);

    focusFallback(target);

    expect(target).not.toHaveAttribute('tabindex');
  });
});

describe('restoreFocusAfterRemoval', () => {
  it('disconnects a kept-row watch 500 ms after refresh settlement', async () => {
    vi.useFakeTimers();
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    const heading = document.createElement('h2');
    scope.append(opener, heading);
    document.body.append(scope);
    opener.focus();
    let settle!: () => void;
    const refresh = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const stop = restoreFocusAfterRemoval({ opener, scope, target: () => heading, refresh });
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(disconnect).not.toHaveBeenCalled();
      settle();
      await vi.advanceTimersByTimeAsync(499);
      expect(disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(disconnect).toHaveBeenCalledOnce();
      opener.remove();
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      expect(heading).not.toHaveAttribute('tabindex');
    } finally {
      stop();
      scope.remove();
      vi.useRealTimers();
    }
  });

  it('stops when a connected opener blurs to the body', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    const heading = document.createElement('h2');
    scope.append(opener, heading);
    document.body.append(scope);
    opener.focus();
    const stop = restoreFocusAfterRemoval({ opener, scope, target: () => heading });
    try {
      opener.blur();
      await Promise.resolve();
      scope.append(document.createElement('span'));
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      opener.remove();
      await Promise.resolve();
      expect(heading).not.toHaveAttribute('tabindex');
    } finally {
      stop();
      scope.remove();
    }
  });

  it('does not recover into the page while the modal has reopened', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    const heading = document.createElement('h2');
    const modal = document.createElement('dialog');
    scope.append(opener, heading, modal);
    document.body.append(scope);
    opener.focus();
    const stop = restoreFocusAfterRemoval({ opener, scope, modal, target: () => heading });
    try {
      modal.open = true;
      opener.remove();
      await Promise.resolve();
      expect(heading).not.toHaveAttribute('tabindex');
      modal.open = false;
      await waitFor(() => expect(heading).toHaveFocus());
    } finally {
      stop();
      scope.remove();
    }
  });

  it('keeps watching when a connected fallback cannot yet receive focus', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    const heading = document.createElement('h2');
    scope.append(opener, heading);
    document.body.append(scope);
    opener.focus();
    const focus = vi.spyOn(heading, 'focus').mockImplementationOnce(() => undefined);
    const stop = restoreFocusAfterRemoval({ opener, scope, target: () => heading });
    try {
      opener.remove();
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      expect(heading).not.toHaveAttribute('tabindex');
      scope.append(document.createElement('span'));
      await waitFor(() => expect(heading).toHaveFocus());
      expect(focus).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      scope.remove();
    }
  });

  it('waits for an explicit fallback inserted after the opener was removed', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    scope.append(opener);
    document.body.append(scope);
    opener.focus();
    const stop = restoreFocusAfterRemoval({
      opener,
      scope,
      target: () => document.getElementById('late-heading'),
    });
    try {
      opener.remove();
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      const heading = document.createElement('h2');
      heading.id = 'late-heading';
      scope.append(heading);
      await waitFor(() => expect(heading).toHaveFocus());
    } finally {
      stop();
      scope.remove();
    }
  });

  it('preserves a deliberate focus change when the opener later disappears', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    const heading = document.createElement('h2');
    const input = document.createElement('input');
    scope.append(opener, heading, input);
    document.body.append(scope);
    opener.focus();
    const stop = restoreFocusAfterRemoval({ opener, scope, target: () => heading });
    try {
      input.focus();
      opener.remove();
      await Promise.resolve();
      expect(input).toHaveFocus();
      expect(heading).not.toHaveAttribute('tabindex');
    } finally {
      stop();
      scope.remove();
    }
  });

  it('abandons a removed section instead of focusing a replacement page target', async () => {
    const scope = document.createElement('section');
    const opener = document.createElement('button');
    scope.append(opener);
    document.body.append(scope);
    opener.focus();
    const stop = restoreFocusAfterRemoval({
      opener,
      scope,
      target: () => document.getElementById('replacement-heading'),
    });
    const replacement = document.createElement('h2');
    replacement.id = 'replacement-heading';
    try {
      scope.remove();
      await Promise.resolve();
      document.body.append(replacement);
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      expect(replacement).not.toHaveAttribute('tabindex');
    } finally {
      stop();
      replacement.remove();
    }
  });
});
