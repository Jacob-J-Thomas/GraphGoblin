import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_STORAGE_KEY, syncFontAcrossTabs } from '../../lib/font.js';
import { syncThemeAcrossTabs, THEME_STORAGE_KEY } from '../../lib/theme.js';
import { AppearanceSection } from './AppearanceSection.js';

const FACES = [
  'Geist',
  'Space Grotesk',
  'Chakra Petch',
  'Atkinson Hyperlegible',
  'OpenDyslexic',
  'Inter',
];

beforeEach(() => {
  document.documentElement.dataset['theme'] = 'dark';
});

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['font'];
});

describe('AppearanceSection', () => {
  it('offers Dark and Light as a labelled radio group, Dark chosen by default', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toHaveAccessibleDescription(/Dark is the default/);
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

describe('the Font control', () => {
  it('offers every face by name in a labelled radio group, Geist chosen by default', () => {
    render(<AppearanceSection />);
    const group = screen.getByRole('radiogroup', { name: 'Font' });
    expect(group).toHaveAccessibleDescription(/Geist is the default.*code stays in Geist Mono/);
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-labelledby'))).toHaveLength(6);
    for (const [index, name] of FACES.entries()) {
      expect(radios[index]).toHaveAccessibleName(name);
    }
    expect(within(group).getByRole('radio', { name: 'Geist' })).toBeChecked();
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(within(group).getByRole('radio', { name: 'Chakra Petch' })).toHaveAccessibleDescription(
      /headings and wordmark; text stays in Geist/,
    );
    expect(within(group).getByRole('radio', { name: 'OpenDyslexic' })).toHaveAccessibleDescription(
      /dyslexic/,
    );
  });

  it('previews each face in itself: the option sets data-font, its name the display token', () => {
    render(<AppearanceSection />);
    for (const radio of within(screen.getByRole('radiogroup', { name: 'Font' })).getAllByRole(
      'radio',
    )) {
      const option = radio.closest('label');
      expect(option).toHaveAttribute('data-font', radio.getAttribute('value'));
      const name = document.getElementById(radio.getAttribute('aria-labelledby') ?? '');
      expect(name).toHaveClass('font-display');
      const description = document.getElementById(radio.getAttribute('aria-describedby') ?? '');
      expect(description).toHaveClass('font-sans');
      expect(option).toContainElement(name);
      expect(option).toContainElement(description);
    }
  });

  it('applies a click at once, remembers it, and leaves the theme alone', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByText('OpenDyslexic'));
    expect(screen.getByRole('radio', { name: 'OpenDyslexic' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Geist' })).not.toBeChecked();
    expect(document.documentElement.dataset['font']).toBe('opendyslexic');
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe('opendyslexic');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('follows the keyboard: Tab reaches the chosen face, the arrow keys choose', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    // The theme group comes first; Tab leaves it for the chosen face.
    screen.getByRole('radio', { name: 'Dark' }).focus();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Geist' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Space Grotesk' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Space Grotesk' })).toHaveFocus();
    expect(document.documentElement.dataset['font']).toBe('space-grotesk');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Atkinson Hyperlegible' })).toBeChecked();
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe('atkinson-hyperlegible');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Chakra Petch' })).toBeChecked();
    expect(document.documentElement.dataset['font']).toBe('chakra-petch');
  });

  it('shows the face the page already shows, and Geist for an unknown one', () => {
    document.documentElement.dataset['font'] = 'inter';
    const { unmount } = render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Inter' })).toBeChecked();
    unmount();
    document.documentElement.dataset['font'] = 'papyrus';
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Geist' })).toBeChecked();
  });

  it('reflects a face chosen in another tab', () => {
    const stop = syncFontAcrossTabs();
    render(<AppearanceSection />);
    act(() => {
      localStorage.setItem(FONT_STORAGE_KEY, 'inter');
      window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    });
    expect(screen.getByRole('radio', { name: 'Inter' })).toBeChecked();
    act(() => {
      localStorage.removeItem(FONT_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    });
    expect(screen.getByRole('radio', { name: 'Geist' })).toBeChecked();
    stop();
  });

  it('still switches when storage throws, without remembering the choice', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await user.click(screen.getByText('Inter'));
    expect(screen.getByRole('radio', { name: 'Inter' })).toBeChecked();
    expect(document.documentElement.dataset['font']).toBe('inter');
    blocked.mockRestore();
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBeNull();
  });
});
