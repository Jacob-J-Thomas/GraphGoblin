import { json } from '@codemirror/lang-json';
import { defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { afterEach, describe, expect, it } from 'vitest';
import { codeTheme, roleOf, tokenHighlighter } from './code-theme.js';

type Tag = Parameters<typeof roleOf>[0][number];

/** Real lezer tags, taken from CodeMirror's default style (this package cannot import them). */
function tag(name: string): Tag {
  for (const spec of defaultHighlightStyle.specs) {
    const tags = (Array.isArray(spec.tag) ? spec.tag : [spec.tag]) as Tag[];
    const found = tags.find((t) => t.toString() === name);
    if (found) return found;
  }
  throw new Error(`no tag ${name} in the default style`);
}

const views: EditorView[] = [];
afterEach(() => {
  while (views.length) views.pop()?.destroy();
});

function render(doc: string, language: Extension): HTMLElement {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [codeTheme, language] }),
    parent,
  });
  views.push(view);
  return view.contentDOM;
}

const classesOf = (root: HTMLElement) =>
  [...root.querySelectorAll('span')].map((span) => [span.className, span.textContent]);

describe('code theme', () => {
  it('maps tags, and their parents, to syntax roles', () => {
    expect(roleOf([tag('keyword')])).toBe('keyword');
    expect(roleOf([tag('comment')])).toBe('comment');
    expect(roleOf([tag('string')])).toBe('string');
    expect(roleOf([tag('invalid')])).toBe('invalid');
    expect(roleOf([tag('className')])).toBeUndefined();
    expect(roleOf([tag('className'), tag('meta')])).toBe('operator');
    expect(tokenHighlighter.style([tag('literal')])).toBeNull();
    expect(tokenHighlighter.style([tag('keyword')])).toBe('gg-tok-keyword');
  });

  it('colours JSON keys, strings, numbers, and literals', () => {
    const classes = classesOf(render('{"name": "loop", "count": 2, "on": true}', json()));
    expect(classes).toContainEqual(['gg-tok-property', '"name"']);
    expect(classes).toContainEqual(['gg-tok-string', '"loop"']);
    expect(classes).toContainEqual(['gg-tok-number', '2']);
    expect(classes).toContainEqual(['gg-tok-number', 'true']);
  });

  it('draws the search panel (Ctrl+F) and its matches with the tokens, not the base theme', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'the cat and the hat',
        extensions: [basicSetup, codeTheme],
      }),
      parent,
    });
    views.push(view);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }),
    );
    const style = (selector: string) => {
      const element = view.dom.querySelector(selector);
      if (!element) throw new Error(`no ${selector}`);
      return getComputedStyle(element);
    };
    expect(style('.cm-panels').backgroundColor).toBe('var(--surface-overlay)');
    const field = style('.cm-textfield');
    expect(field.backgroundColor).toBe('var(--surface-field)');
    expect(field.color).toBe('var(--text-default)');
    const button = style('.cm-button');
    expect(button.backgroundImage).toBe('none');
    expect(button.backgroundColor).toBe('var(--surface-control)');
    expect(button.color).toBe('var(--text-default)');
    expect(style('.cm-search label').color).toBe('var(--text-default)');
    expect(style('.cm-search [name=close]').color).toBe('var(--text-muted)');
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/\.cm-searchMatch \{[^}]*var\(--code-match\)/);
    expect(css).toMatch(/\.cm-searchMatch-selected \{[^}]*var\(--code-match-selected\)/);
  });

  it('colours Liquid delimiters and comments, and JSONata operators', () => {
    const liquid = classesOf(render('{{ lastOutput }} {# note #}', StreamLanguage.define(jinja2)));
    expect(liquid).toContainEqual(['gg-tok-operator', '{{']);
    expect(liquid.some(([name]) => name === 'gg-tok-comment')).toBe(true);
    const jsonata = classesOf(
      render('vars.severity >= 2 ? "yes" : "no"', StreamLanguage.define(javascript)),
    );
    expect(jsonata).toContainEqual(['gg-tok-operator', '>=']);
    expect(jsonata).toContainEqual(['gg-tok-string', '"yes"']);
  });
});
