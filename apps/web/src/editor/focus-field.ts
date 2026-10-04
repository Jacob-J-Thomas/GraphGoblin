/**
 * Moving focus to the field an issue is about. Schema-driven forms mark each field's container with
 * `data-field="<path>"` (forms/fields/shared.tsx `Row`, and the object, array, record, and union
 * fieldsets), where the path is relative to the form's value; the node editor marks its own fields
 * (`id`, `label`) and the config form with `data-field-scope` so an issue path such as
 * `config.routes.0.label` finds its control.
 *
 * #14 will collapse rarely used fields into Advanced groups; `focusField` is where it will expand
 * the group holding the field before focusing it.
 */

/**
 * What can take focus inside a field, in order of preference: the controls that hold the value
 * (inputs, selects, text areas, switches, CodeMirror editors), then anything else (an "Add"
 * button, say). Within each group the first in document order wins.
 */
const VALUE_CONTROLS = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button[role="switch"]:not([disabled])',
  '[contenteditable="true"]',
].join(',');
const OTHER_CONTROLS = [
  'button:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * A radio of a segmented control stands for its group: focus goes to the chosen radio, as Tab
 * would, so the arrow keys move on from the current choice.
 */
function chosenRadio(radio: HTMLInputElement): HTMLElement {
  const group = radio.closest('[role="radiogroup"]');
  return group?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ?? radio;
}

/** The control to focus inside `field`: the first value control, else the first other one. */
function firstFocusable(field: Element): HTMLElement | undefined {
  for (const selector of [VALUE_CONTROLS, OTHER_CONTROLS]) {
    const found = [...field.querySelectorAll<HTMLElement>(selector)].find(
      (el) => !el.closest('[hidden], [inert]'),
    );
    if (found instanceof HTMLInputElement && found.type === 'radio') return chosenRadio(found);
    if (found) return found;
  }
  return undefined;
}

/**
 * Focus the first control inside `[data-field="<path>"]` under `root`. When no field has the full
 * path (a nested field whose form shows its parent as one JSON editor, say), the parent paths are
 * tried in turn: `routes.0.label`, then `routes.0`, then `routes`. Returns whether anything took
 * focus; the caller decides the fallback (the node editor's heading).
 *
 * Paths come from user data (a record key may hold a quote, a backslash, or a newline), so the
 * attribute values are compared as strings rather than built into a selector.
 */
export function focusField(root: ParentNode, path: string): boolean {
  const fields = [...root.querySelectorAll('[data-field]')];
  const segments = path.split('.').filter((segment) => segment !== '');
  for (let length = segments.length; length > 0; length -= 1) {
    const name = segments.slice(0, length).join('.');
    const field = fields.find((el) => el.getAttribute('data-field') === name);
    const control = field ? firstFocusable(field) : undefined;
    if (control) {
      control.focus();
      return true;
    }
  }
  return false;
}

/**
 * Focus the field an issue path names inside the node editor: `config.<path>` in the config form
 * (scope `config`), anything else (`id`, `label`) among the node's own fields (scope `node`).
 */
export function focusIssuePath(root: ParentNode, path: string): boolean {
  const inConfig = path === 'config' || path.startsWith('config.');
  const scope = root.querySelector(`[data-field-scope="${inConfig ? 'config' : 'node'}"]`);
  if (!scope) return false;
  return focusField(scope, inConfig ? path.slice('config'.length + 1) : path);
}
