import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Icon } from '../icons/index.js';
import { ellipsize } from './ellipsis.js';
import {
  Alert,
  Badge,
  Button,
  buttonStyles,
  Card,
  Checkbox,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from './index.js';

describe('Button', () => {
  it('is a plain button by default with the primary look', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Publish</Button>);
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-accent', 'text-on-accent', 'shadow-ledge-accent', 'h-9');
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies each variant and size, keeps a submit type, and merges classes', () => {
    render(
      <>
        <Button variant="secondary" size="sm">
          Secondary
        </Button>
        <Button variant="outline">Outline</Button>
        <Button variant="destructive" type="submit" className="mt-3">
          Destructive
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close" />
        <Button disabled>Disabled</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass(
      'bg-surface-control',
      'h-8',
    );
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveClass('bg-surface-raised');
    const destructive = screen.getByRole('button', { name: 'Destructive' });
    expect(destructive).toHaveClass('bg-danger', 'text-on-danger', 'mt-3');
    expect(destructive).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('bg-transparent', 'size-8');
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('lends its look to a link that sits among buttons', () => {
    render(
      <a href="/runs/new" className={buttonStyles({ variant: 'outline', className: 'ml-2' })}>
        New run
      </a>,
    );
    expect(screen.getByRole('link', { name: 'New run' })).toHaveClass(
      'bg-surface-raised',
      'h-9',
      'ml-2',
    );
    expect(buttonStyles()).toContain('bg-accent');
  });

  it('stays within its container: an overlong label ends in an ellipsis, named in full', () => {
    const long = 'long action '.repeat(45).trim();
    render(
      <Button>
        <Icon name="send" /> {long}
      </Button>,
    );
    const button = screen.getByRole('button', { name: long });
    expect(button).toHaveClass('max-w-full', 'whitespace-nowrap');
    const label = screen.getByText(long);
    expect(label).toHaveClass('min-w-0', 'overflow-x-clip', 'text-ellipsis');
    expect(label.parentElement).toBe(button);
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });
});

describe('fields', () => {
  it('labels inputs, selects, and textareas', () => {
    render(
      <>
        <FieldGroup className="extra">
          <Label htmlFor="name">Name</Label>
          <Input id="name" defaultValue="loop" aria-invalid />
          <HelpText>Letters and digits.</HelpText>
          <HelpText tone="bad">Already used</HelpText>
        </FieldGroup>
        <Label htmlFor="effort">Effort</Label>
        <Select id="effort" defaultValue="low">
          <option>low</option>
          <option>high</option>
        </Select>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" className="font-sans" defaultValue="hello" />
      </>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('loop');
    expect(input).toHaveClass('bg-surface-field', 'border-strong', 'h-9');
    expect(input.parentElement).toHaveClass('grid', 'gap-1.5', 'extra');
    expect(screen.getByText('Letters and digits.')).toHaveClass('text-muted');
    expect(screen.getByText('Already used')).toHaveClass('text-status-bad-fg');
    const select = screen.getByLabelText('Effort');
    expect(select).toHaveValue('low');
    expect(select).toHaveClass('appearance-none');
    expect(select.parentElement?.querySelector('svg[data-icon="chevron"]')).not.toBeNull();
    const notes = screen.getByLabelText('Notes');
    expect(notes).toHaveClass('font-mono', 'font-sans');
  });
});

describe('Checkbox', () => {
  it('is a native checkbox drawn as a box with an accent fill and a tick', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Enable" className="extra" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Enable' });
    expect(box).toHaveClass('appearance-none', 'border-strong', 'checked:bg-accent');
    expect(box.parentElement).toHaveClass('extra');
    expect(box.parentElement?.querySelector('svg[data-icon="check"]')).not.toBeNull();
    await userEvent.setup().click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(box).toBeChecked();
  });
});

describe('Card', () => {
  it('renders a head with title and actions over a padded body', () => {
    render(
      <Card title="Model catalog" actions={<Button size="sm">Add model</Button>}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Model catalog', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add model' })).toBeInTheDocument();
    expect(screen.getByText('body').parentElement).toHaveClass('p-5');
  });

  it('renders actions without a title, and a flush body', () => {
    const { container } = render(
      <Card actions={<span>actions</span>} flush className="mine">
        <p>table</p>
      </Card>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('actions')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('overflow-hidden', 'mine');
    expect(screen.getByText('table').parentElement).not.toHaveClass('p-5');
    expect(screen.getByText('table').parentElement).toHaveClass('overflow-x-auto');
  });

  it('renders only the body when there is no head', () => {
    const { container } = render(<Card>plain</Card>);
    expect(container.querySelector('header')).toBeNull();
  });
});

describe('Badge', () => {
  it('maps tones and sizes to status tokens', () => {
    render(
      <>
        <Badge>neutral</Badge>
        <Badge tone="good">good</Badge>
        <Badge tone="bad" size="sm">
          bad
        </Badge>
        <Badge tone="warn">warn</Badge>
        <Badge tone="info" className="extra">
          info
        </Badge>
      </>,
    );
    const badge = (text: string) => screen.getByText(text).parentElement;
    expect(badge('neutral')).toHaveClass('bg-status-neutral-bg', 'h-6');
    expect(badge('good')).toHaveClass('bg-status-good-bg', 'text-status-good-fg');
    expect(badge('bad')).toHaveClass('bg-status-bad-bg', 'h-5');
    expect(badge('warn')).toHaveClass('bg-status-warn-bg');
    expect(badge('info')).toHaveClass('bg-status-info-bg', 'extra');
  });

  it('stays within its container: overlong text ends in an ellipsis beside a full-size icon', () => {
    const long = 'long badge '.repeat(45).trim();
    render(
      <>
        <Badge tone="warn">{long}</Badge>
        <Badge tone="bad" size="sm" title="Validation issues">
          <Icon name="failed" />
          {3} issue{'s'}
        </Badge>
      </>,
    );
    const text = screen.getByText(long);
    expect(text).toHaveClass('min-w-0', 'overflow-x-clip', 'text-ellipsis');
    expect(text.parentElement).toHaveClass('max-w-full', 'whitespace-nowrap', 'inline-flex');
    // Text runs join into one span; the icon stays outside it, so it never shrinks.
    const issues = screen.getByText('3 issues');
    expect(issues.parentElement?.children).toHaveLength(2);
    expect(issues.parentElement?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });
});

describe('ellipsize', () => {
  it('wraps each run of text in one shrinkable span and passes elements through', () => {
    const { container } = render(
      <p>
        {ellipsize(['a', 1, <b key="b">bold</b>, ' ', <i key="i">italic</i>, 'tail', null, false])}
      </p>,
    );
    const p = container.firstElementChild as HTMLElement;
    expect([...p.children].map((c) => `${c.tagName.toLowerCase()}:${c.textContent}`)).toEqual([
      'span:a1',
      'b:bold',
      'i:italic',
      'span:tail',
    ]);
    expect(ellipsize(undefined)).toEqual([]);
  });
});

describe('Alert', () => {
  it('announces failures as alerts and everything else as status, with a tone icon', () => {
    render(
      <>
        <Alert title="Publish failed">The draft could not be saved.</Alert>
        <Alert tone="warn" title="The draft changed on the server" />
        <Alert tone="good">Published version 4.</Alert>
        <Alert tone="info">Restored.</Alert>
        <Alert tone="neutral" className="extra">
          Nothing to publish.
        </Alert>
      </>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Publish failedThe draft could not be saved.');
    expect(alert.querySelector('svg[data-icon="failed"]')).not.toBeNull();
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(4);
    expect(statuses[0]?.querySelector('svg[data-icon="alert"]')).not.toBeNull();
    expect(statuses[1]?.querySelector('svg[data-icon="check-circle"]')).not.toBeNull();
    expect(statuses[2]?.querySelector('svg[data-icon="info"]')).not.toBeNull();
    expect(statuses[3]).toHaveClass('bg-status-neutral-bg', 'extra');
    expect(screen.getByText('The draft changed on the server')).toHaveClass('text-status-warn-fg');
  });

  it('breaks an overlong word instead of spilling out of its box', () => {
    const word = 'W'.repeat(350);
    render(<Alert title={word}>{word}</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('wrap-anywhere', 'min-w-0', 'grid-cols-[auto_minmax(0,1fr)]');
    expect(alert.lastElementChild).toHaveClass('min-w-0');
  });
});

describe('Table', () => {
  it('renders header and data cells', () => {
    render(
      <Table className="extra">
        <thead>
          <tr>
            <Th>Name</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td className="text-xs">nightly</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('table')).toHaveClass('border-separate', 'extra');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('bg-surface-sunken');
    expect(screen.getByRole('cell', { name: 'nightly' })).toHaveClass('text-xs', 'border-default');
  });
});
