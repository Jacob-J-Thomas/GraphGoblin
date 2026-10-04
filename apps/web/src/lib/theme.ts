/**
 * The colour theme (#11). Dark is the default and light the alternate. The choice is kept in this
 * browser's localStorage under THEME_STORAGE_KEY as the theme's name; "system" (follow the
 * operating system) is reserved for the installer, so the stored value is a plain name that a later
 * build can extend. Any value this build does not know, an empty store, or storage that cannot be
 * read (private mode, blocked site data, a throwing accessor) shows the default.
 *
 * The <html> element's data-theme attribute is the single source of truth on the page: the boot
 * script in index.html sets it from storage before first paint (see themeBootScript), setTheme
 * changes it, and the storage event keeps other tabs in step. The theme-color meta tag follows it,
 * using the per-theme colours the build reads from tokens.css (data-dark and data-light).
 */
import { useEffect, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light'];

export const DEFAULT_THEME: Theme = 'dark';

export const THEME_STORAGE_KEY = 'graphgoblin-theme';

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** The stored theme, or the default when there is none, it is unknown, or storage throws. */
export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remember the theme in this browser. Returns false when storage refuses (the theme still applies). */
export function writeStoredTheme(theme: Theme): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Show a theme: the data-theme attribute, and the browser chrome colour for it. */
export function applyTheme(theme: Theme, doc: Document = window.document): void {
  doc.documentElement.dataset['theme'] = theme;
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const colour = meta?.dataset[theme];
  if (meta && colour) meta.content = colour;
}

/** The theme the page shows now. */
export function currentTheme(): Theme {
  const shown = window.document.documentElement.dataset['theme'];
  return isTheme(shown) ? shown : DEFAULT_THEME;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Choose a theme: shown at once, remembered when storage allows, and announced to subscribers. */
export function setTheme(theme: Theme): void {
  writeStoredTheme(theme);
  applyTheme(theme);
  notify();
}

/**
 * Follow a theme chosen in another tab (or storage cleared there): the storage event fires in every
 * other tab of this origin. Returns the cleanup.
 */
export function syncThemeAcrossTabs(target: Window = window): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    applyTheme(readStoredTheme());
    notify();
  };
  target.addEventListener('storage', onStorage);
  return () => target.removeEventListener('storage', onStorage);
}

/**
 * Follow other tabs while the calling component is mounted (the app root does this), so mounting
 * the app again never leaves a second listener behind.
 */
export function useThemeAcrossTabs(): void {
  useEffect(() => syncThemeAcrossTabs(), []);
}

/** The current theme and the setter, for components. */
export function useTheme(): readonly [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => DEFAULT_THEME);
  return [theme, setTheme] as const;
}

/**
 * The classic script index.html runs in <head>, before the stylesheet, so the stored theme is
 * shown from the first paint. The build inlines it (vite.config.ts): the API sends no
 * Content-Security-Policy, and inline avoids a blocking request. It tolerates storage that throws
 * and leaves the static data-theme="dark" for anything it does not recognise. It runs after the
 * theme-color meta tag, which carries both themes' colours.
 */
export function themeBootScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const themes = JSON.stringify(THEMES);
  return (
    `(function(){try{var t=window.localStorage.getItem(${key});` +
    `if(${themes}.indexOf(t)<0)return;` +
    `document.documentElement.setAttribute('data-theme',t);` +
    `var m=document.querySelector('meta[name="theme-color"]');` +
    `var c=m&&m.getAttribute('data-'+t);if(c)m.setAttribute('content',c);` +
    `}catch(e){}})();`
  );
}
