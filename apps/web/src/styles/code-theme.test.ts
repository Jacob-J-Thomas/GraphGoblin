import { json } from '@codemirror/lang-json';
import { defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
