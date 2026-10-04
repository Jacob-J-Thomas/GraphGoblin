import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell, MainNav, Page, PageHeader } from './index.js';

const NAV = [
  { to: '/loops', label: 'Loops' },
  { to: '/runs', label: 'Runs', attention: '1 waiting for input' },
];

describe('MainNav', () => {
  it('marks the current page and keeps link names', () => {
    render(
      <MemoryRouter initialEntries={['/loops']}>
        <MainNav
          items={[
            { to: '/loops', label: 'Loops' },
            { to: '/runs', label: 'Runs' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Loops' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Runs' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByTestId('nav-attention')).not.toBeInTheDocument();
  });

  it('shows an attention dot with screen-reader text', () => {
    render(
      <MemoryRouter initialEntries={['/loops']}>
        <MainNav items={NAV} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('nav-attention')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /^Runs ?, 1 waiting for input$/ })).toBeInTheDocument();
  });

  it('opens and closes the narrow-width menu', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/loops']}>
        <MainNav items={NAV} />
      </MemoryRouter>,
    );
    const menu = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', nav.id);
    expect(nav).toHaveClass('max-sm:hidden');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveClass('max-sm:flex');
    expect(menu.querySelector('svg[data-icon="close"]')).not.toBeNull();
    await user.click(screen.getByRole('link', { name: /Runs/ }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AppShell', () => {
  it('frames the screen with the logo, navigation, and offline banner', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AppShell nav={NAV}>
          <p>screen</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('screen')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('GraphGoblin');
    expect(screen.queryByText('You are offline')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AppShell nav={NAV} offline>
          <p>screen</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('You are offline');
  });
});

describe('Page and PageHeader', () => {
  it('renders a capped column with a title, details, and actions', () => {
    const { container } = render(
      <Page className="extra">
        <PageHeader title="Loops" actions={<button type="button">New</button>}>
          <span>details</span>
        </PageHeader>
      </Page>,
    );
    expect(container.firstElementChild).toHaveClass('max-w-[1240px]', 'p-page', 'extra');
    expect(screen.getByRole('heading', { level: 1, name: 'Loops' })).toBeInTheDocument();
    expect(screen.getByText('details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('lets a wide page use the full width and omits empty actions', () => {
    const { container } = render(
      <Page wide>
        <PageHeader title="Run" />
      </Page>,
    );
    expect(container.firstElementChild).not.toHaveClass('max-w-[1240px]');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
