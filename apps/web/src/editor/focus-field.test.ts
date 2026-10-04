import { afterEach, describe, expect, it } from 'vitest';
import { focusField, focusIssuePath } from './focus-field.js';

/** A node editor body as the dialog renders it: the node's own fields, then the config form. */
function editorBody(): HTMLElement {
  const root = document.createElement('section');
  root.innerHTML = `
    <div data-field-scope="node">
      <div data-field="id"><label for="i">Node id</label><input id="i" /></div>
      <div data-field="label"><input aria-label="Label" /></div>
    </div>
    <div data-field-scope="config">
      <div data-field="label"><input aria-label="Config label" /></div>
      <fieldset data-field="routes">
        <button type="button">Remove routes</button>
        <fieldset data-field="routes.0">
          <div data-field="routes.0.label"><input aria-label="Route label" /></div>
        </fieldset>
      </fieldset>
      <div data-field="prompt"><span>Liquid</span><div contenteditable="true" aria-label="Prompt"></div></div>
      <div data-field="channels"><div hidden><input aria-label="Hidden" /></div><button type="button">Customize channels</button></div>
      <div data-field="off"><input aria-label="Disabled" disabled /></div>
      <div data-field='odd"name'><input aria-label="Odd" /></div>
    </div>`;
  document.body.append(root);
  return root;
}

/** The element labelled `name` (compared directly: names may hold any character). */
const named = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[aria-label]')].find(
    (el) => el.getAttribute('aria-label') === name,
  )!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusField', () => {
  it('focuses the first control inside the field at a path', () => {
    const root = editorBody();
    const config = root.querySelector('[data-field-scope="config"]')!;
    expect(focusField(config, 'routes.0.label')).toBe(true);
    expect(named(root, 'Route label')).toHaveFocus();
    expect(focusField(config, 'prompt')).toBe(true);
    expect(named(root, 'Prompt')).toHaveFocus();
    expect(focusField(config, 'odd"name')).toBe(true);
    expect(named(root, 'Odd')).toHaveFocus();
  });

  it('finds fields whose path holds any character, such as a record key with a newline', () => {
    const root = editorBody();
    const config = root.querySelector('[data-field-scope="config"]')!;
    const env = config.appendChild(document.createElement('fieldset'));
    env.setAttribute('data-field', 'env');
    const keys = ['bad\nkey', 'quote"and\\back\\slash', "it's]\t[x=y"];
    for (const key of keys) {
      const row = env.appendChild(document.createElement('div'));
      row.setAttribute('data-field', `env.${key}`);
      const input = row.appendChild(document.createElement('input'));
      input.setAttribute('aria-label', `value of ${key}`);
    }
    for (const key of keys) {
      expect(focusField(config, `env.${key}`)).toBe(true);
      expect(named(root, `value of ${key}`)).toHaveFocus();
      expect(focusIssuePath(root, `config.env.${key}`)).toBe(true);
      expect(named(root, `value of ${key}`)).toHaveFocus();
    }
    // A key that is not there falls back to the record itself, without throwing.
    expect(focusField(config, 'env.other\nkey')).toBe(true);
    expect(named(root, `value of ${keys[0]}`)).toHaveFocus();
  });

  it('falls back to the parent paths, preferring a value control over a button', () => {
    const root = editorBody();
    const config = root.querySelector('[data-field-scope="config"]')!;
    // routes.3.label and routes.3 do not exist: routes does, and its first input wins over Remove.
    expect(focusField(config, 'routes.3.label')).toBe(true);
    expect(named(root, 'Route label')).toHaveFocus();
    // A field whose only value control is hidden or disabled: its button takes focus.
    expect(focusField(config, 'channels.0.kind')).toBe(true);
    expect(root.querySelector('[data-field="channels"] button')).toHaveFocus();
    expect(focusField(config, 'off')).toBe(false);
  });

  it('reports false when nothing matches', () => {
    const root = editorBody();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusField(root, 'nothing.here')).toBe(false);
    expect(focusField(root, '')).toBe(false);
    expect(document.body).toHaveFocus();
  });
});

describe('focusIssuePath', () => {
  it('looks in the config form for config paths and among the node fields otherwise', () => {
    const root = editorBody();
    expect(focusIssuePath(root, 'config.label')).toBe(true);
    expect(named(root, 'Config label')).toHaveFocus();
    expect(focusIssuePath(root, 'label')).toBe(true);
    expect(named(root, 'Label')).toHaveFocus();
    expect(focusIssuePath(root, 'id')).toBe(true);
    expect(root.querySelector('#i')).toHaveFocus();
    expect(focusIssuePath(root, 'config.routes.0.label')).toBe(true);
    expect(named(root, 'Route label')).toHaveFocus();
    // The whole config, or a node property with no field: nothing to focus.
    expect(focusIssuePath(root, 'config')).toBe(false);
    expect(focusIssuePath(root, 'kind')).toBe(false);
  });

  it('reports false without the scopes', () => {
    const root = document.body.appendChild(document.createElement('div'));
    expect(focusIssuePath(root, 'label')).toBe(false);
    expect(focusIssuePath(root, 'config.prompt')).toBe(false);
  });
});
