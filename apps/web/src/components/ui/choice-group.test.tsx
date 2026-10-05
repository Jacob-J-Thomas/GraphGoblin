import { render, screen, within } from '@testing-library/react';
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
function Planets({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('Earth');
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
      />
      <p id="planet-help">Pick one.</p>
      <output data-testid="planet">{value}</output>
    </>
  );
}

describe('ChoiceGroup', () => {
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
    }
    // One name for the group, generated when none is given.
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
    expect(group.lastElementChild).toHaveClass('grid', 'sm:grid-cols-2', 'lg:grid-cols-3');
    expect(screen.getByRole('radio', { name: 'Earth' })).toBeChecked();
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
  });
});
