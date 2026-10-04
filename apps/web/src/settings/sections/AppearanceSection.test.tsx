import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncThemeAcrossTabs, THEME_STORAGE_KEY } from '../../lib/theme.js';
import { AppearanceSection } from './AppearanceSection.js';

beforeEach(() => {
  document.documentElement.dataset['theme'] = 'dark';
});

afterEach(() => {
  delete document.documentElement.dataset['theme'];
});

describe('AppearanceSection', () => {
  it('offers Dark and Light as a labelled radio group, Dark chosen by default', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Theme' });
    const dark = screen.getByRole('radio', { name: 'Dark' });
    const light = screen.getByRole('radio', { name: 'Light' });
    expect(group).toContainElement(dark);
    expect(dark).toBeChecked();
    expect(light).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'System' })).not.toBeInTheDocument();
  });

  it('switches at once, persists, and follows the keyboard', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // Tab reaches the chosen radio; the arrow keys move the choice and apply it.
    screen.getByRole('radio', { name: 'Light' }).blur();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('reflects a theme chosen in another tab', () => {
    const stop = syncThemeAcrossTabs();
    render(<AppearanceSection />);
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    });
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    stop();
  });
});
