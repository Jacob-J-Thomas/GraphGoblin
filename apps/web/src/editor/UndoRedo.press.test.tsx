import { act, render, screen } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonStyles } from '../components/ui/index.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { UndoRedo } from './UndoRedo.js';

/*
 * What a pressed Undo or Redo does is decided by the cascade, which jsdom does not run: tests here
 * generate the real stylesheet for the exact classes on the rendered buttons with Tailwind's own
 * compiler and evaluate the cascade for the pressed states (important beats normal, then
 * specificity, then order). Where the buttons sit, and whether a press that is held on their top
 * pixel row still lands, is for a native browser (e2e/undo.spec.ts and independent native QA).
 */

interface Declaration {
  property: string;
  value: string;
  important: boolean;
}
interface Rule {
  /** The utility class this rule is generated for. */
  utility: string;
  /** The rest of the selector after the class: its pseudo-classes and attribute tests. */
  state: string;
  declarations: Declaration[];
  order: number;
}

/** The class named at the start of a selector, and what follows it. */
function splitSelector(selector: string): { utility: string; state: string } {
  let name = '';
  let index = 1;
  while (index < selector.length) {
    const char = selector[index]!;
    if (char === '\\') {
      name += selector[index + 1]!;
      index += 2;
    } else if (/[:.[\s>+~(,]/.test(char)) break;
    else {
      name += char;
      index += 1;
    }
  }
  return { utility: name, state: selector.slice(index) };
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  for (const match of css.matchAll(/(?:^|\n)\s*(\.[^{}]+?)\s*\{([^{}]*)\}/g)) {
    const { utility, state } = splitSelector(match[1]!);
    const declarations = match[2]!
      .split(';')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text): Declaration => {
        const colon = text.indexOf(':');
        const value = text.slice(colon + 1).trim();
        const important = /\s*!important$/.test(value);
        return {
          property: text.slice(0, colon).trim(),
          value: value.replace(/\s*!important$/, ''),
          important,
        };
      });
    rules.push({ utility, state, declarations, order: rules.length });
  }
  return rules;
}

interface Situation {
  /** The button is pressed: `:active`, with the mouse over it. */
  pressed: boolean;
  /** The button carries `aria-disabled="true"` (nothing to undo or redo). */
  ariaDisabled: boolean;
}

const STATE_TOKEN =
  /:not\(\[aria-disabled="true"\]\)|\[aria-disabled="true"\]|:active|:hover|:focus-visible|:disabled/g;

/** Whether a rule's state part holds in `situation`, and how specific its selector is. */
function matches(state: string, situation: Situation): { applies: boolean; specificity: number } {
  // A rule with a combinator (the icon's `[&_svg]:size-[15px]`) styles a descendant, not the button.
  if (/[\s>+~]/.test(state)) return { applies: false, specificity: 0 };
  const tokens = state.match(STATE_TOKEN) ?? [];
  // Refuse a selector this evaluator does not understand rather than guess at the cascade.
  if (tokens.join('') !== state) throw new Error(`Unknown selector state: ${state}`);
  // A mouse press has the pointer over the button. It is not a keyboard focus ring state, and an
  // `aria-disabled` button is never `:disabled`.
  const holds = (token: string) =>
    token === ':active' || token === ':hover'
      ? situation.pressed
      : token === '[aria-disabled="true"]'
        ? situation.ariaDisabled
        : token === ':not([aria-disabled="true"])'
          ? !situation.ariaDisabled
          : false;
  return {
    applies: tokens.every(holds),
    // The class, plus one for each pseudo-class or attribute test (also inside :not).
    specificity: 1 + tokens.length,
  };
}

/** The winning declaration of `property` for a button with `classes`, by the cascade. */
function winner(
  rules: readonly Rule[],
  classes: readonly string[],
  property: string,
  situation: Situation,
): Declaration | undefined {
  const candidates = rules.flatMap((rule) => {
    if (!classes.includes(rule.utility)) return [];
    const { applies, specificity } = matches(rule.state, situation);
    if (!applies) return [];
    return rule.declarations
      .filter((declaration) => declaration.property === property)
      .map((declaration) => ({ declaration, specificity, order: rule.order }));
  });
  candidates.sort(
    (a, b) =>
      Number(b.declaration.important) - Number(a.declaration.important) ||
      b.specificity - a.specificity ||
      b.order - a.order,
  );
  return candidates[0]?.declaration;
}

async function stylesheetFor(classes: readonly string[]): Promise<Rule[]> {
  const compiler = await compile(
    '@theme { --border-color-strong: #888888; --color-surface-hover: #eeeeee; } @tailwind utilities;',
  );
  return parseRules(compiler.build([...classes]));
}

const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean);
/** Properties that would move or resize a button (or its content) if a press changed them. */
const GEOMETRY = [
  'translate',
  'transform',
  'scale',
  'rotate',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'width',
  'height',
  'min-width',
  'min-height',
  'border-width',
  'border-top-width',
  'border-bottom-width',
  'border-left-width',
  'border-right-width',
];

describe('Undo and Redo pressed state', () => {
  beforeEach(() => store().load('L1', newLoopDefinition('a')));
  afterEach(() => store().reset());
  const store = () => useEditorStore.getState();

  it('does not move when pressed, enabled or not, while the shared ghost style still does', async () => {
    act(() => store().moveNode('start', { x: 40, y: 80 }));
    render(<UndoRedo apple={false} />);
    const undo = screen.getByRole('button', { name: 'Undo move start' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).not.toHaveAttribute('aria-disabled');
    expect(redo).toHaveAttribute('aria-disabled', 'true');

    const rules = await stylesheetFor([...classesOf(undo), ...classesOf(redo)]);
    for (const [button, ariaDisabled] of [
      [undo, false],
      [redo, true],
    ] as const) {
      const classes = classesOf(button);
      const rest = { pressed: false, ariaDisabled };
      const pressed = { pressed: true, ariaDisabled };
      // At rest nothing translates; pressed, the single winning declaration is `none`, and it is
      // !important, so no stylesheet order or specificity of the ghost style can override it.
      expect(winner(rules, classes, 'translate', rest)).toBeUndefined();
      expect(winner(rules, classes, 'translate', pressed)).toEqual({
        property: 'translate',
        value: 'none',
        important: true,
      });
      // No other property that would move or resize the button changes when it is pressed.
      for (const property of GEOMETRY) {
        if (property === 'translate') continue;
        expect(winner(rules, classes, property, pressed)).toEqual(
          winner(rules, classes, property, rest),
        );
      }
    }

    // The buttons have no translation of their own to lose: the ghost rule is still the same
    // `0 1px` nudge for every other ghost button, which this change must not touch.
    const ghost = classesOf(
      render(<button className={buttonStyles({ variant: 'ghost', size: 'icon' })} />).container
        .firstElementChild!,
    );
    const ghostRules = await stylesheetFor(ghost);
    const nudge = winner(ghostRules, ghost, 'translate', { pressed: true, ariaDisabled: false });
    expect(nudge).toEqual({
      property: 'translate',
      value: 'var(--tw-translate-x) var(--tw-translate-y)',
      important: false,
    });
    expect(
      winner(ghostRules, ghost, '--tw-translate-y', { pressed: true, ariaDisabled: false }),
    ).toMatchObject({ value: '1px' });
  });

  it('shows the press as a strong border on an enabled button only, without changing its size', async () => {
    act(() => store().moveNode('start', { x: 40, y: 80 }));
    render(<UndoRedo apple={false} />);
    const undo = screen.getByRole('button', { name: 'Undo move start' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    const rules = await stylesheetFor([...classesOf(undo), ...classesOf(redo)]);
    const border = (button: HTMLElement, pressed: boolean, ariaDisabled: boolean) =>
      winner(rules, classesOf(button), 'border-color', { pressed, ariaDisabled })?.value;
    expect(border(undo, false, false)).toBe('transparent');
    expect(border(undo, true, false)).toBe('var(--border-color-strong)');
    // Nothing to do: it keeps its muted look, so it does not look pressable.
    expect(border(redo, false, true)).toBe('transparent');
    expect(border(redo, true, true)).toBe('transparent');
  });

  it('keeps the 32 px and 44 px sizes, and the focus ring, of the shared icon button', () => {
    render(<UndoRedo apple={false} />);
    for (const name of ['Undo', 'Redo']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('size-8', 'pointer-coarse:size-11');
      expect(button).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-focus');
    }
  });

  it('leaves the shared button styles alone: every variant keeps its own press', () => {
    for (const variant of [
      'default',
      'secondary',
      'outline',
      'destructive',
      'destructive-soft',
      'ghost',
    ] as const) {
      const classes = buttonStyles({ variant, size: 'icon' });
      expect(classes).toMatch(/active:translate-y-(px|0\.5)/);
      expect(classes).not.toContain('translate-none');
    }
  });
});
