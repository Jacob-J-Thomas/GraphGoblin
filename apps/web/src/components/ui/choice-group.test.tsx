import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceGroup, type Choice } from './choice-group.js';

/** The states every option shares, whatever its layout. */
const SHARED = [
  'cursor-pointer',
  'text-muted',
  'peer-[:not(:checked)]:hover:bg-surface-hover',
  'peer-checked:bg-accent-subtle',
  'peer-checked:text-accent-on-subtle',
  'peer-checked:ring-1',
  'peer-checked:ring-accent-strong',
  'peer-checked:ring-inset',
  'peer-focus-visible:outline-2',
  'peer-focus-visible:outline-focus',
  'forced-colors:peer-checked:outline',
  'peer-disabled:cursor-not-allowed',
];

const PLANETS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter'];

/** Five described options in the grid layout, each marking its option with data-planet. */
function Planets({
  disabled = false,
  descriptionTooltips = false,
  initialValue = 'Earth',
}: {
  disabled?: boolean;
  descriptionTooltips?: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const choices: Choice[] = PLANETS.map((planet) => ({
    key: planet,
    value: planet.toLowerCase(),
    checked: value === planet,
    onSelect: () => setValue(planet),
    label: planet,
    description: `${planet} is a planet.`,
    data: { 'data-planet': planet },
  }));
  return (
    <>
      <ChoiceGroup
        legend="Planet"
        layout="grid"
        choices={choices}
        describedBy="planet-help"
        disabled={disabled}
        descriptionTooltips={descriptionTooltips}
      />
      <p id="planet-help">Pick one.</p>
      <output data-testid="planet">{value}</output>
    </>
  );
}

describe('ChoiceGroup', () => {
  it('opts into compact labels with persistent accessible descriptions and separate help buttons', () => {
    render(<Planets descriptionTooltips />);
    for (const planet of PLANETS) {
      const radio = screen.getByRole('radio', { name: planet });
      expect(radio).toHaveAccessibleDescription(`${planet} is a planet.`);
      const description = document.getElementById(radio.getAttribute('aria-describedby')!);
      expect(description).toHaveClass('sr-only');
      const help = screen.getByRole('button', { name: `${planet} help` });
      expect(help.closest('label')).toBeNull();
      expect(help).toHaveAttribute('tabindex', '-1');
      expect(help).toHaveAccessibleDescription(`${planet} is a planet.`);
      expect(radio.nextElementSibling).toHaveClass('content-center', 'pointer-coarse:min-h-11');
      expect(radio.nextElementSibling).not.toHaveClass('content-start', 'min-h-8');
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows help on hover, keeps it under the pointer and closes after leaving', async () => {
    const user = userEvent.setup();
    render(<Planets descriptionTooltips />);
    const help = screen.getByRole('button', { name: 'Mars help' });
    await user.hover(help);
    const popup = await screen.findByRole('dialog', { name: 'Option help' });
    expect(popup).toHaveTextContent('Mars is a planet.');
    await user.hover(popup);
    expect(popup).toBeVisible();
    await user.unhover(popup);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
  });

  it('has one Tab stop, showing radio focus help and closing on blur or Escape without moving focus', async () => {
    const user = userEvent.setup();
    render(<Planets descriptionTooltips />);
    const earth = screen.getByRole('radio', { name: 'Earth' });
    await user.tab();
    expect(earth).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
      'Earth is a planet.',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(earth).toHaveFocus();
    expect(earth).toBeChecked();
    expect(earth).toHaveAccessibleDescription('Earth is a planet.');
    await user.tab();
    expect(document.body).toHaveFocus();
    await user.tab({ shift: true });
    expect(earth).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Option help' })).toBeVisible();
    await user.tab();
    expect(document.body).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['mouse', 'touch'])(
    'selects the visible card with %s without opening focus help',
    async (pointer) => {
      const user = userEvent.setup();
      render(<Planets descriptionTooltips />);
      const label = screen.getByText('Mars', { exact: true });
      if (pointer === 'mouse') await user.click(label);
      else
        await user.pointer([
          { keys: '[TouchA>]', target: label },
          { keys: '[/TouchA]', target: label },
        ]);
      const mars = screen.getByRole('radio', { name: 'Mars' });
      expect(mars).toBeChecked();
      expect(mars).toHaveFocus();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
      expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
        'Earth is a planet.',
      );
    },
  );

  it('shows keyboard focus help after a cancelled label press', async () => {
    const user = userEvent.setup();
    render(<Planets descriptionTooltips />);
    const label = within(screen.getByRole('radiogroup', { name: 'Planet' })).getByText('Earth', {
      exact: true,
    });
    fireEvent.pointerDown(label);
    fireEvent.pointerCancel(label);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Earth' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
      'Earth is a planet.',
    );
  });

  it('keeps focus quiet when card selection remounts the picker and restores focus', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Planets descriptionTooltips />);
    const label = screen.getByText('Mars', { exact: true });
    // The editor remounts its form within the click, before the browser's next task.
    fireEvent.pointerDown(label);
    fireEvent.pointerUp(label);
    fireEvent.click(label);
    expect(screen.getByRole('radio', { name: 'Mars' })).toBeChecked();
    rerender(<Planets key="remounted" descriptionTooltips initialValue="Mars" />);
    const mars = screen.getByRole('radio', { name: 'Mars' });
    mars.focus();
    expect(mars).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.tab();
    await user.tab({ shift: true });
    expect(mars).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
      'Mars is a planet.',
    );
  });

  it('opens on touch tap without selecting the option and a second tap dismisses it', async () => {
    const user = userEvent.setup();
    render(<Planets descriptionTooltips />);
    const help = screen.getByRole('button', { name: 'Mars help' });
    await user.pointer([
      { keys: '[TouchA>]', target: help },
      { keys: '[/TouchA]', target: help },
    ]);
    expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
      'Mars is a planet.',
    );
    expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
    await user.pointer([
      { keys: '[TouchA>]', target: help },
      { keys: '[/TouchA]', target: help },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
  });

  it('keeps native arrow selection with help enabled and disables both radios and help', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Planets descriptionTooltips />);
    screen.getByRole('radio', { name: 'Earth' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Mars' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mars' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Option help' })).toHaveTextContent(
      'Mars is a planet.',
    );
    rerender(<Planets descriptionTooltips disabled />);
    for (const control of [...screen.getAllByRole('radio'), ...screen.getAllByRole('button')])
      expect(control).toBeDisabled();
  });

  it('in the grid layout, names each radio by its label and describes it by its description', () => {
    render(<Planets />);
    const group = screen.getByRole('radiogroup', { name: 'Planet' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group).toHaveAccessibleDescription('Pick one.');
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(5);
    for (const [index, planet] of PLANETS.entries()) {
      const radio = radios[index]!;
      expect(radio).toHaveAccessibleName(planet);
      expect(radio).toHaveAccessibleDescription(`${planet} is a planet.`);
      expect(radio).toHaveAttribute('value', planet.toLowerCase());
      expect(radio.closest('label')).toHaveAttribute('data-planet', planet);
      expect(radio.closest('label')).toHaveClass('grid', 'min-w-0');
      expect(radio.nextElementSibling).toHaveClass(...SHARED, 'content-start');
      expect(radio.nextElementSibling).not.toHaveAttribute('title');
      expect(document.getElementById(radio.getAttribute('aria-describedby')!)).not.toHaveClass(
        'sr-only',
      );
    }
    // One name for the group, generated when none is given.
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
    expect(group.lastElementChild).toHaveClass('grid', 'sm:grid-cols-2', 'lg:grid-cols-3');
    expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps native radio keyboard behaviour in the grid', async () => {
    const user = userEvent.setup();
    render(<Planets />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Earth' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Mars' })).toBeChecked();
    expect(screen.getByTestId('planet')).toHaveTextContent('Mars');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Venus' })).toBeChecked();
    await user.click(screen.getByText('Jupiter'));
    expect(screen.getByTestId('planet')).toHaveTextContent('Jupiter');
  });

  it('disables every radio with the fieldset', () => {
    render(<Planets disabled />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('in the row layout, ellipsizes labels and keeps their text as the name and the tooltip', () => {
    const onSelect = vi.fn();
    render(
      <ChoiceGroup
        legend="Mode"
        name="mode"
        required
        invalid
        choices={[
          { key: 'a', value: 'a', checked: true, onSelect, label: 'Automatic' },
          { key: 'm', value: 'm', checked: false, onSelect, label: <b>Manual</b> },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group.querySelector('legend')).toHaveTextContent('Mode*');
    const automatic = screen.getByRole('radio', { name: 'Automatic' });
    expect(automatic).not.toHaveAttribute('aria-labelledby');
    expect(automatic.nextElementSibling).toHaveClass(...SHARED, 'whitespace-nowrap', 'h-7');
    expect(automatic.nextElementSibling).toHaveAttribute('title', 'Automatic');
    expect(screen.getByText('Automatic')).toHaveClass('text-ellipsis');
    // A label that is not plain text gets no tooltip.
    const manual = screen.getByRole('radio', { name: 'Manual' });
    expect(manual.nextElementSibling).not.toHaveAttribute('title');
    expect(manual).toHaveAttribute('name', 'mode');
  });

  it('shows a grid label without a description as it is, named by the label', () => {
    render(
      <ChoiceGroup
        legend="Size"
        layout="grid"
        descriptionTooltips
        choices={[
          { key: 's', value: 's', checked: false, onSelect: vi.fn(), label: 'Small' },
          { key: 'l', value: 'l', checked: true, onSelect: vi.fn(), label: 'Large' },
        ]}
      />,
    );
    const large = screen.getByRole('radio', { name: 'Large' });
    expect(large).toBeChecked();
    expect(large).not.toHaveAttribute('aria-describedby');
    expect(large.nextElementSibling).toHaveTextContent('Large');
    expect(large.nextElementSibling?.querySelector('.text-ellipsis')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
  });
});
