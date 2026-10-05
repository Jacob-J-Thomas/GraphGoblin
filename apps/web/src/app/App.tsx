import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { ApiKeyPanel } from '../api/ApiKeyPanel.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { AppShell, Page, type NavItem } from '../components/layout/index.js';
import { EditorPage } from '../editor/EditorPage.js';
import { EventsPage } from '../events/EventsPage.js';
import { useConnectionStatus } from '../lib/online.js';
import { LoopsPage } from '../loops/LoopsPage.js';
import { UpdateToast } from '../pwa/UpdateToast.js';
import { NewRunPage } from '../runs/new/NewRunPage.js';
import { RunInspectorPage } from '../runs/RunInspectorPage.js';
import { RunsPage } from '../runs/RunsPage.js';
import { SettingsPage } from '../settings/SettingsPage.js';

const NAV: readonly NavItem[] = [
  { to: '/loops', label: 'Loops' },
  { to: '/runs', label: 'Runs' },
  { to: '/events', label: 'Events' },
  { to: '/settings', label: 'Settings' },
];

function Layout() {
  const connection = useConnectionStatus();
  const location = useLocation();
  return (
    <AppShell
      nav={NAV}
      offline={connection === 'offline'}
      apiUnreachable={connection === 'api-unreachable'}
    >
      <ApiKeyPanel />
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
      <UpdateToast />
    </AppShell>
  );
}

function NotFound() {
  return (
    <Page>
      <p className="text-md text-muted">Page not found.</p>
    </Page>
  );
}

/** Remount the editor per loop so its local state never leaks between loops. */
function EditorRoute() {
  const { loopId } = useParams();
  return <EditorPage key={loopId} />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/loops" replace />} />
        <Route path="loops" element={<LoopsPage />} />
        <Route path="loops/:loopId/edit" element={<EditorRoute />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/new" element={<NewRunPage />} />
        <Route path="runs/:runId" element={<RunInspectorPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
