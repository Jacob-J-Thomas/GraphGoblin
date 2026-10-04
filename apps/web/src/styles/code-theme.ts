/**
 * CodeMirror 6 in the design tokens: the editor chrome (surface, gutter, active line, selection,
 * cursor, tooltips, search) and syntax colours, all as CSS variables, so the editors follow the
 * theme (data-theme) without being rebuilt.
 *
 * Syntax colours come from a small highlighter keyed by lezer tag names rather than from a
 * HighlightStyle, which would need @lezer/highlight's `tags` as a direct dependency. A tag falls
 * back through its parents (`Tag.set`, most specific first), so `lineComment` is a comment and
 * `integer` a number. The Liquid editor runs CodeMirror's Jinja2 stream mode, whose `{{ }}` and
 * `{% %}` delimiters arrive as `tagName` and are coloured as operators.
 */
import { syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

type Highlighter = Parameters<typeof syntaxHighlighting>[0];
type Tag = Parameters<Highlighter['style']>[0][number];

export type SyntaxRole =
  'keyword' | 'property' | 'string' | 'number' | 'operator' | 'comment' | 'invalid';

const ROLE_BY_TAG: Record<string, SyntaxRole> = {
  keyword: 'keyword',
  typeName: 'keyword',
  propertyName: 'property',
  string: 'string',
  regexp: 'string',
  number: 'number',
  bool: 'number',
  null: 'number',
  atom: 'number',
  operator: 'operator',
  tagName: 'operator',
  meta: 'operator',
  comment: 'comment',
  invalid: 'invalid',
};

/** The syntax role of a token's tags: the first tag, or parent tag, that has one. */
export function roleOf(tags: readonly Tag[]): SyntaxRole | undefined {
  for (const tag of tags) {
    for (const candidate of tag.set) {
      const role = ROLE_BY_TAG[candidate.toString()];
      if (role) return role;
    }
  }
  return undefined;
}

/** Gives each highlighted token a `gg-tok-<role>` class; the theme below colours the classes. */
export const tokenHighlighter: Highlighter = {
  style: (tags) => {
    const role = roleOf(tags);
    return role ? `gg-tok-${role}` : null;
  },
};

const ROLE_STYLES: Record<SyntaxRole, Record<string, string>> = {
  keyword: { color: 'var(--code-keyword)', fontWeight: 'var(--font-weight-medium)' },
  property: { color: 'var(--code-keyword)' },
  string: { color: 'var(--code-string)' },
  number: { color: 'var(--code-number)' },
  operator: { color: 'var(--code-operator)', fontWeight: 'var(--font-weight-semibold)' },
  comment: { color: 'var(--code-comment)', fontStyle: 'italic' },
  invalid: { color: 'var(--status-bad-fg)', textDecoration: 'underline wavy' },
};

const SELECTION = 'var(--accent-subtle)';

export const codeTheme: Extension = [
  EditorView.theme({
    '&': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--code-fg)',
      fontSize: '12.5px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '20px' },
    '.cm-content': { caretColor: 'var(--code-fg)', padding: '6px 0' },
    '.cm-line': { padding: '0 12px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-fg)' },
    '.cm-gutters': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--code-gutter)',
      borderRight: '1px solid var(--border-default)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--code-active-line)', color: 'var(--code-fg)' },
    '.cm-selectionLayer .cm-selectionBackground': { backgroundColor: SELECTION },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: SELECTION,
    },
    '.cm-content ::selection': { backgroundColor: SELECTION },
    '.cm-selectionMatch': { backgroundColor: 'var(--surface-hover)' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--surface-hover)',
      outline: '1px solid var(--border-strong)',
    },
    '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--status-bad-fg)' },
    '.cm-placeholder': { color: 'var(--text-subtle)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface-hover)',
      border: '1px solid var(--border-default)',
      color: 'var(--text-muted)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface-overlay)',
      color: 'var(--text-default)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-2)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-subtle)',
      color: 'var(--accent-on-subtle)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--surface-overlay)',
      color: 'var(--text-default)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border-default)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border-default)' },
    '.cm-searchMatch': {
      backgroundColor: 'var(--status-warn-bg)',
      outline: '1px solid var(--status-warn-border)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-subtle)' },
    ...Object.fromEntries(
      Object.entries(ROLE_STYLES).map(([role, style]) => [`.gg-tok-${role}`, style]),
    ),
  }),
  syntaxHighlighting(tokenHighlighter),
];
