/**
 * Reads a semantic token's colour out of tokens.css, following `var()` references down to the
 * primitive tier. The build uses it for the colours that cannot be CSS variables, the
 * `theme-color` meta tag and the web manifest (vite.config.ts), so they come from the palette
 * instead of repeating a literal.
 */

export type ThemeName = 'light' | 'dark';

const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g;
const BLOCK = /([^{}]+)\{([^{}]*)\}/g;

/** Declarations of every rule whose selector list matches `select`, later rules winning. */
function declarations(css: string, select: (selector: string) => boolean): Map<string, string> {
  const found = new Map<string, string>();
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector = '', body = ''] of source.matchAll(BLOCK)) {
    if (!select(selector.trim())) continue;
    for (const [, name = '', value = ''] of body.matchAll(DECLARATION)) {
      found.set(name, value.trim());
    }
  }
  return found;
}

const isRoot = (selector: string) => selector.split(',').some((s) => s.trim() === ':root');
const isTheme = (theme: ThemeName) => (selector: string) =>
  selector.includes(`[data-theme='${theme}']`);

/**
 * The colour a token resolves to in `theme`: the theme's own declaration wins over the `:root`
 * declarations (the primitive tier and the light defaults).
 */
export function tokenColor(css: string, theme: ThemeName, token: string): string {
  const scope = new Map([...declarations(css, isRoot), ...declarations(css, isTheme(theme))]);
  let value = scope.get(token);
  const seen = new Set<string>([token]);
  for (;;) {
    if (value === undefined) throw new Error(`${token} is not declared for the ${theme} theme`);
    const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    if (!reference) return value;
    if (seen.has(reference)) throw new Error(`${token} refers to itself through ${reference}`);
    seen.add(reference);
    value = scope.get(reference);
  }
}

/** The installed app's chrome: the header colour and the splash background of the default theme. */
export function appChromeColors(css: string, theme: ThemeName = 'dark') {
  return {
    themeColor: tokenColor(css, theme, '--surface-inverse'),
    backgroundColor: tokenColor(css, theme, '--surface-app'),
  };
}
