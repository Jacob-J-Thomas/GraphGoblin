/**
 * The typeface (#40). Geist is the default; the other faces are a shortlist the owner prunes. The
 * choice is kept in this browser's localStorage under FONT_STORAGE_KEY as the face's id. Any value
 * this build does not know, an empty store, or storage that cannot be read (private mode, blocked
 * site data, a throwing accessor) shows Geist, and an unknown value is left in place.
 *
 * The <html> element's data-font attribute is the single source of truth on the page (no attribute
 * is Geist): the boot script in index.html sets it from storage before first paint (see
 * fontBootScript), setFont changes it, and the storage event keeps other tabs in step. A choice only
 * swaps the --font-ui and --font-display tokens (styles/fonts.css); code stays in Geist Mono.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type Font =
  'geist' | 'space-grotesk' | 'chakra-petch' | 'atkinson-hyperlegible' | 'opendyslexic' | 'inter';

/** The faces in the order Settings offers them. */
export const FONTS: readonly Font[] = [
  'geist',
  'space-grotesk',
  'chakra-petch',
  'atkinson-hyperlegible',
  'opendyslexic',
  'inter',
];

export const DEFAULT_FONT: Font = 'geist';

export const FONT_STORAGE_KEY = 'graphgoblin-font';

/**
 * The files each face shows first, relative to the app's base (public/fonts): the boot script
 * preloads them, so the first paint waits as little as possible for the swap. Chakra Petch is a
 * headings face over Geist text, so it needs both; other weights load when a rule asks for them.
 */
export const FONT_PRELOADS: Readonly<Record<Font, readonly string[]>> = {
  geist: ['fonts/Geist-Variable.woff2'],
  'space-grotesk': ['fonts/SpaceGrotesk-Variable.woff2'],
  'chakra-petch': ['fonts/Geist-Variable.woff2', 'fonts/ChakraPetch-SemiBold.woff2'],
  'atkinson-hyperlegible': ['fonts/AtkinsonHyperlegibleNext-Variable.woff2'],
  opendyslexic: ['fonts/OpenDyslexic-Regular.woff2'],
  inter: ['fonts/Inter-Variable.woff2'],
};

export function isFont(value: unknown): value is Font {
  return FONTS.includes(value as Font);
}

/** The stored face, or Geist when there is none, it is unknown, or storage throws. */
export function readStoredFont(): Font {
  try {
    const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
    return isFont(stored) ? stored : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

/** Remember the face in this browser. Returns false when storage refuses (the face still applies). */
export function writeStoredFont(font: Font): boolean {
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, font);
    return true;
  } catch {
    return false;
  }
}

/** Show a face: the data-font attribute on <html>, which styles/fonts.css maps to the tokens. */
export function applyFont(font: Font, doc: Document = window.document): void {
  doc.documentElement.dataset['font'] = font;
}

/** The face the page shows now. */
export function currentFont(): Font {
  const shown = window.document.documentElement.dataset['font'];
  return isFont(shown) ? shown : DEFAULT_FONT;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeFont(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Choose a face: shown at once, remembered when storage allows, and announced to subscribers. */
export function setFont(font: Font): void {
  writeStoredFont(font);
  applyFont(font);
  notify();
}

/**
 * Follow a face chosen in another tab (or storage cleared there): the storage event fires in every
 * other tab of this origin. Returns the cleanup.
 */
export function syncFontAcrossTabs(target: Window = window): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== FONT_STORAGE_KEY && event.key !== null) return;
    applyFont(readStoredFont());
    notify();
  };
  target.addEventListener('storage', onStorage);
  return () => target.removeEventListener('storage', onStorage);
}

/** Follow other tabs while the calling component is mounted (the app root does this). */
export function useFontAcrossTabs(): void {
  useEffect(() => syncFontAcrossTabs(), []);
}

/** The current face and the setter, for components. */
export function useFont(): readonly [Font, (font: Font) => void] {
  const font = useSyncExternalStore(subscribeFont, currentFont, () => DEFAULT_FONT);
  return [font, setFont] as const;
}

/**
 * The classic script index.html runs in <head>, before the stylesheet, so the stored face is in
 * place from the first paint: it sets data-font for a known stored face (leaving none, which is
 * Geist, for anything else) and preloads the face's files under `base` (the app's base path, such
 * as "/app/"). The build inlines it after the theme's script (vite.config.ts). It tolerates
 * storage that throws, and the preload never depends on storage.
 */
export function fontBootScript(base: string): string {
  const key = JSON.stringify(FONT_STORAGE_KEY);
  const fonts = JSON.stringify(FONTS);
  const preloads = JSON.stringify(
    Object.fromEntries(FONTS.map((font) => [font, FONT_PRELOADS[font].map((path) => base + path)])),
  );
  return (
    `(function(){var f=${JSON.stringify(DEFAULT_FONT)};` +
    `try{var s=window.localStorage.getItem(${key});` +
    `if(${fonts}.indexOf(s)>=0){f=s;document.documentElement.setAttribute('data-font',f);}` +
    `}catch(e){}` +
    `var p=${preloads}[f];` +
    `for(var i=0;i<p.length;i++){var l=document.createElement('link');l.rel='preload';` +
    `l.as='font';l.type='font/woff2';l.crossOrigin='anonymous';l.href=p[i];` +
    `document.head.appendChild(l);}})();`
  );
}
