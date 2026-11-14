import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useHeldDuringPress, usePrimaryPress } from './pointer-press.js';

function Probe() {
  return <output aria-label="pressed">{String(usePrimaryPress())}</output>;
}
const pressed = () => screen.getByLabelText('pressed').textContent;

function setup() {
  const view = render(
    <>
      <Probe />
      <input aria-label="field" />
      <div data-testid="elsewhere">elsewhere</div>
      <button type="button">target</button>
    </>,
  );
  return {
    view,
    button: screen.getByRole('button', { name: 'target' }),
    field: screen.getByLabelText('field'),
    elsewhere: screen.getByTestId('elsewhere'),
  };
}

/** Let the task after the current one run: where a release that no click followed ends. */
const nextTask = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** What the page showed when each click reached `target`, before any later render. */
function shownAtClick(target: Element) {
  const shown: (string | null)[] = [];
  target.addEventListener('click', () => shown.push(pressed()));
  return shown;
}

describe('usePrimaryPress (#273 A2)', () => {
  it('starts at a primary press the window sees before any element, not at other buttons', () => {
    const { button } = setup();
    expect(pressed()).toBe('false');
    const stop = vi.fn((event: Event) => event.stopPropagation());
    button.addEventListener('pointerdown', stop);
    fireEvent.pointerDown(button, { button: 0 });
    expect(stop).toHaveBeenCalled();
    expect(pressed()).toBe('true');
    fireEvent.pointerCancel(button);

    fireEvent.pointerDown(button, { button: 2 });
    fireEvent.mouseDown(button, { button: 1 });
    expect(pressed()).toBe('false');
  });

  it('lasts through a mouse release until its click has been delivered', () => {
    const { button, field } = setup();
    const shown = shownAtClick(button);
    field.focus();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.mouseDown(button, { button: 0 });
    // Focus moving to the pressed button blurs the field, which passes the window: the press goes on.
    const blurred = vi.fn();
    field.addEventListener('blur', blurred);
    act(() => button.focus());
    expect(blurred).toHaveBeenCalled();
    expect(pressed()).toBe('true');
    fireEvent.pointerUp(button, { button: 0 });
    expect(pressed()).toBe('true');
    fireEvent.mouseUp(button, { button: 0 });
    expect(pressed()).toBe('true');
    fireEvent.click(button);
    // The click reached the button with the press still held, and ended it after.
    expect(shown).toEqual(['true']);
    expect(pressed()).toBe('false');
  });

  it('ends at the click of a release elsewhere, delivered to the common ancestor', () => {
    const { button, elsewhere } = setup();
    const atButton = vi.fn();
    button.addEventListener('click', atButton);
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(elsewhere, { button: 0 });
    fireEvent.mouseUp(elsewhere, { button: 0 });
    expect(pressed()).toBe('true');
    fireEvent.click(document.body);
    expect(atButton).not.toHaveBeenCalled();
    expect(pressed()).toBe('false');
  });

  it('ends a release no click follows, or whose click is stopped, at the next task', async () => {
    const { button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button, { button: 0 });
    expect(pressed()).toBe('true');
    await nextTask();
    expect(pressed()).toBe('false');

    button.addEventListener('click', (event) => event.stopPropagation());
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button, { button: 0 });
    fireEvent.mouseUp(button, { button: 0 });
    fireEvent.click(button);
    expect(pressed()).toBe('true');
    await nextTask();
    expect(pressed()).toBe('false');
  });

  it('keeps a new press that begins before the last one settled', async () => {
    const { button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button, { button: 0 });
    fireEvent.pointerDown(button, { button: 0 });
    await nextTask();
    expect(pressed()).toBe('true');
    fireEvent.pointerUp(button, { button: 0 });
    fireEvent.click(button);
    expect(pressed()).toBe('false');
  });

  it('follows a tap: its pointer events, then its compatibility mouse events and click', async () => {
    const { button } = setup();
    const shown = shownAtClick(button);
    fireEvent.pointerDown(button, { button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(button, { button: 0, pointerType: 'touch' });
    // The tap's click comes in a later task; nothing has moved focus yet.
    await nextTask();
    expect(pressed()).toBe('false');
    fireEvent.mouseDown(button, { button: 0 });
    expect(pressed()).toBe('true');
    fireEvent.mouseUp(button, { button: 0 });
    fireEvent.click(button);
    expect(shown).toEqual(['true']);
    expect(pressed()).toBe('false');
  });

  it('ends at once when the browser cancels the pointer or a drag ends', () => {
    const { button } = setup();
    fireEvent.pointerDown(button, { button: 0, pointerType: 'touch' });
    fireEvent.pointerCancel(button);
    expect(pressed()).toBe('false');

    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.dragEnd(button);
    expect(pressed()).toBe('false');
  });

  it('ends at once when the window loses focus', () => {
    const { button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.blur(window);
    expect(pressed()).toBe('false');
  });

  it('never holds for a keyboard click, nor ends a press with one', () => {
    const { button } = setup();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button, { detail: 0 });
    expect(pressed()).toBe('false');
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.click(button, { detail: 0 });
    expect(pressed()).toBe('true');
    fireEvent.pointerCancel(button);
  });

  it('removes its listeners with the last subscriber and forgets a press under way', async () => {
    const { view, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button, { button: 0 });
    expect(pressed()).toBe('true');
    view.unmount();
    await nextTask();
    fireEvent.pointerDown(document.body, { button: 0 });
    render(<Probe />);
    expect(pressed()).toBe('false');
  });
});

function Held() {
  const [value, setValue] = useState(1);
  const shown = useHeldDuringPress(value);
  return (
    <button type="button" onClick={() => setValue((current) => current + 1)}>
      {`value ${value} shown ${shown}`}
    </button>
  );
}

it('holds a value while a press is under way and follows it otherwise', () => {
  render(<Held />);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(button).toHaveTextContent('value 2 shown 2');
  fireEvent.pointerDown(button, { button: 0 });
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(button, { detail: 0 });
  expect(button).toHaveTextContent('value 3 shown 2');
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.mouseUp(button, { button: 0 });
  expect(button).toHaveTextContent('value 3 shown 2');
  // The press's own click applies its edit at once; what it shows follows after the click.
  fireEvent.click(button);
  expect(button).toHaveTextContent('value 4 shown 4');
});
