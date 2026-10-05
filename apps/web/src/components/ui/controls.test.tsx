import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Fieldset,
  FilePicker,
  Input,
  Label,
  Legend,
  RequiredMarker,
  RequiredNote,
  SegmentedControl,
  Switch,
} from './index.js';

function ControlledSwitch({ initial = false, disabled = false }) {
  const [on, setOn] = useState(initial);
  return (
    <>
      <Label id="label" htmlFor="switch">
        Enabled
      </Label>
      <Switch
        id="switch"
        aria-labelledby="label"
        checked={on}
        onCheckedChange={setOn}
        disabled={disabled}
      />
    </>
  );
}

describe('Switch', () => {
  it.each([true, 'true'] as const)(
    'retains focus but ignores activation with aria-disabled=%s',
    async (disabled) => {
      const onCheckedChange = vi.fn();
      render(
        <Switch
          aria-label="Pending"
          checked
          aria-disabled={disabled}
          aria-busy
          onCheckedChange={onCheckedChange}
        />,
      );
      const user = userEvent.setup();
      await user.tab();
      const toggle = screen.getByRole('switch', { name: 'Pending' });
      expect(toggle).toHaveFocus();
      expect(toggle).not.toBeDisabled();
      expect(toggle).toHaveClass('aria-disabled:cursor-not-allowed', 'aria-busy:cursor-wait');
      await user.keyboard(' {Enter}');
      await user.click(toggle);
      expect(onCheckedChange).not.toHaveBeenCalled();
      expect(toggle).toHaveFocus();
    },
  );
  it('is a labelled switch that toggles on click, Space, Enter, and a click on its label', async () => {
    const user = userEvent.setup();
    render(<ControlledSwitch />);
    const toggle = screen.getByRole('switch', { name: 'Enabled' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveClass('h-6', 'w-11', 'aria-checked:bg-accent');
    await user.click(toggle);
    expect(toggle).toBeChecked();
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).not.toBeChecked();
    await user.keyboard('{Enter}');
    expect(toggle).toBeChecked();
    await user.click(screen.getByText('Enabled'));
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText('Enabled')).toBe(toggle);
  });

  it('does nothing while disabled, and lets an onClick handler cancel the toggle', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { unmount } = render(<ControlledSwitch initial disabled />);
    const toggle = screen.getByRole('switch', { name: 'Enabled' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    unmount();

    render(
      <Switch
        aria-label="Cancelled"
        checked={false}
        onCheckedChange={onCheckedChange}
        onClick={(event) => event.preventDefault()}
      />,
    );
    await user.click(screen.getByRole('switch', { name: 'Cancelled' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

function Choice({ notSet, initial }: { notSet?: string; initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <>
      {notSet === undefined ? (
        <SegmentedControl
          legend="Stdin"
          options={[
            { value: 'thread', label: 'thread' },
            { value: 'none', label: 'none' },
          ]}
          value={value}
          onChange={setValue}
          required
          invalid
          describedBy="help"
        />
      ) : (
        <SegmentedControl
          legend="Network access"
          notSet={notSet}
          options={[
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
          value={value}
          onChange={setValue}
        />
      )}
      <p id="help">Where input comes from</p>
      <output data-testid="value">{value ?? '(unset)'}</output>
    </>
  );
}

describe('SegmentedControl', () => {
  it('is a named radio group whose arrow keys move the choice', async () => {
    const user = userEvent.setup();
    render(<Choice />);
    const group = screen.getByRole('radiogroup', { name: 'Stdin' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('Where input comes from');
    // The marker sits outside the name.
    expect(group.querySelector('legend')).toHaveTextContent('Stdin*');
    // Nothing chosen yet: no segment is checked.
    expect(screen.getByRole('radio', { name: 'thread' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'none' })).not.toBeChecked();
    await user.click(screen.getByText('thread'));
    expect(screen.getByTestId('value')).toHaveTextContent('thread');
    expect(screen.getByRole('radio', { name: 'thread' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'none' })).toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('none');
  });

  it('offers a "Not set" segment that puts the value back to unset', async () => {
    const user = userEvent.setup();
    render(<Choice notSet="Not set" initial="true" />);
    const group = screen.getByRole('radiogroup', { name: 'Network access' });
    expect(group).not.toHaveAttribute('aria-required');
    expect(group).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Not set' }));
    expect(screen.getByRole('radio', { name: 'Not set' })).toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('(unset)');
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByTestId('value')).toHaveTextContent('false');
  });

  it('ends a long segment label in an ellipsis, keeping the whole text as its name', () => {
    const long = 'Escalate to the on-call reviewer and wait for their decision';
    render(
      <SegmentedControl
        legend="Next step"
        options={[
          { value: 'long', label: long },
          { value: 'short', label: 'Stop' },
        ]}
        value="long"
        onChange={vi.fn()}
      />,
    );
    const radio = screen.getByRole('radio', { name: long });
    const segment = radio.nextElementSibling as HTMLElement;
    expect(segment).toHaveAttribute('title', long);
    expect(segment).toHaveClass('max-w-full', 'min-w-0', 'whitespace-nowrap');
    // The chosen, focus, and forced-colours states come from the shared ChoiceGroup.
    expect(segment).toHaveClass(
      'peer-checked:bg-accent-subtle',
      'peer-checked:ring-accent-strong',
      'peer-focus-visible:outline-focus',
      'forced-colors:peer-checked:outline',
    );
    expect(screen.getByText(long)).toHaveClass('overflow-x-clip', 'text-ellipsis', 'min-w-0');
    expect(radio.closest('label')).toHaveClass('max-w-full', 'min-w-0');
  });

  it('shares one name between its radios and can be disabled', () => {
    render(
      <SegmentedControl
        legend="Theme"
        name="theme"
        disabled
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        value="dark"
        onChange={vi.fn()}
      />,
    );
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('name', 'theme');
      expect(radio).toBeDisabled();
    }
  });
});

describe('FilePicker', () => {
  it('keeps the native file input as the labelled control and shows the chosen name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn((event: { target: HTMLInputElement }) => {
      // Callers may clear the input so the same file can be chosen again.
      event.target.value = '';
    });
    render(
      <>
        <Label htmlFor="import">Import an export</Label>
        <FilePicker id="import" accept=".json" aria-describedby="hint" onChange={onChange} />
        <p id="hint">JSON only</p>
      </>,
    );
    const input = screen.getByLabelText('Import an export');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAccessibleDescription('No file chosen JSON only');
    expect(screen.getByText('Choose file')).toHaveAttribute('aria-hidden', 'true');
    await user.upload(input, new File(['{}'], 'loop.json', { type: 'application/json' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('loop.json')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('loop.json JSON only');
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'a.json'), new File(['b'], 'b.json')] },
    });
    expect(screen.getByText('2 files')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByText('No file chosen')).toBeInTheDocument();
  });

  it('takes keyboard focus on the input and can be disabled, with its own button text', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Input aria-label="Before" />
        <FilePicker aria-label="Upload" buttonLabel="Browse" disabled className="extra" />
      </>,
    );
    expect(screen.getByText('Browse')).toBeInTheDocument();
    const input = screen.getByLabelText('Upload');
    expect(input).toBeDisabled();
    expect(input.closest('.extra')).not.toBeNull();
    screen.getByLabelText('Before').focus();
    await user.tab();
    expect(input).not.toHaveFocus();
  });
});

describe('Fieldset, Legend, and the required marker', () => {
  it('groups fields under a heading, or names a group of choices like a label', () => {
    render(
      <>
        <Fieldset className="extra">
          <Legend>Routes</Legend>
        </Fieldset>
        <fieldset>
          <Legend variant="label">Allowed efforts</Legend>
        </fieldset>
      </>,
    );
    const routes = screen.getByRole('group', { name: 'Routes' });
    expect(routes).toHaveClass('rounded-md', 'border-default', 'extra');
    expect(screen.getByText('Routes')).toHaveClass('font-semibold');
    expect(screen.getByText('Allowed efforts')).toHaveClass('font-medium', 'mb-1.5');
  });

  it('marks a required label outside its text and explains the marker once per form', () => {
    render(
      <>
        <RequiredNote className="extra" />
        <Label htmlFor="name" required>
          Name
        </Label>
        <Input id="name" aria-required />
        <RequiredMarker className="mine" />
      </>,
    );
    expect(screen.getByLabelText('Name')).toBeRequired();
    expect(screen.getByText('Name').tagName).toBe('LABEL');
    expect(screen.getByText('Name').nextElementSibling).toHaveTextContent('*');
    expect(screen.getByText('Name').nextElementSibling).toHaveAttribute('aria-hidden', 'true');
    const note = screen.getByText(/Required fields are marked/);
    expect(note).toHaveAttribute('aria-hidden', 'true');
    expect(note).toHaveClass('extra');
    expect(document.querySelector('.mine')).toHaveClass('text-status-bad-fg');
  });
});
