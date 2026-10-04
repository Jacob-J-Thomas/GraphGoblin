import type { GraphGoblinClient } from '@graphgoblin/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiProvider, createAppClient } from '../api/context.js';
import { applyTheme, currentTheme, readStoredTheme, useThemeAcrossTabs } from '../lib/theme.js';
import { registerPwa } from '../pwa/register.js';
import { App } from './App.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 2_000, refetchOnWindowFocus: true },
    },
  });
}

/** Providers shared by the app and its tests: API client, server-state cache. */
export function Providers({
  client,
  queryClient,
  children,
}: {
  client: GraphGoblinClient;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiProvider>
  );
}

/** Keeps the theme in step with other tabs for as long as the app is mounted. */
function ThemeAcrossTabs() {
  useThemeAcrossTabs();
  return null;
}

export interface BootstrapOptions {
  /** API origin. Defaults to the page origin: the API serves the app under /app/. */
  baseUrl?: string;
  basename?: string;
  registerServiceWorker?: boolean;
}

/**
 * Mount the app into `container`, follow theme changes made in other tabs while it is mounted, and
 * register the service worker. index.html's boot script has already shown the stored theme; if it
 * could not run (a future Content-Security-Policy, say), the stored theme is applied here instead,
 * late but right.
 */
export function bootstrap(container: HTMLElement, options: BootstrapOptions = {}): Root {
  const client = createAppClient(options.baseUrl ?? window.location.origin);
  const stored = readStoredTheme();
  if (stored !== currentTheme()) applyTheme(stored);
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ThemeAcrossTabs />
      <Providers client={client} queryClient={createQueryClient()}>
        <BrowserRouter basename={options.basename ?? '/app'}>
          <App />
        </BrowserRouter>
      </Providers>
    </StrictMode>,
  );
  if (options.registerServiceWorker ?? true) registerPwa();
  return root;
}
