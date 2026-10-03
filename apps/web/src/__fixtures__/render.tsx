import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { createAppClient } from '../api/context.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { FakeApi } from './fake-api.js';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export interface Rendered extends RenderResult {
  api: FakeApi;
  queryClient: QueryClient;
}

/** Render the whole app at `path` against a fake API. */
export function renderApp(path: string, api = new FakeApi()): Rendered {
  return renderWith(<App />, path, api);
}

/** Render any element inside the app's providers and a router at `path`. */
export function renderWith(
  ui: ReactNode,
  path = '/',
  api = new FakeApi(),
  routePath?: string,
): Rendered {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  const result = render(
    <Providers client={client} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        {routePath ? (
          <Routes>
            <Route path={routePath} element={ui} />
            <Route path="*" element={<p>elsewhere</p>} />
          </Routes>
        ) : (
          ui
        )}
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
  return { ...result, api, queryClient };
}
