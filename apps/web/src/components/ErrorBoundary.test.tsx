import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.js';

let fail = true;
function Fragile() {
  if (fail) throw new Error('replay exploded');
  return <p>recovered</p>;
}

describe('ErrorBoundary', () => {
  it('shows the error in place of the screen and retries on request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This screen failed to render')).toBeInTheDocument();
    expect(screen.getByText('replay exploded')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
