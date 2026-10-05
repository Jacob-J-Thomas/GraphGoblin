import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { focusFallback } from './focus.js';

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
