import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { ApiKeyPanel } from '../api/ApiKeyPanel.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { Alert } from '../components/ui.js';
import { EditorPage } from '../editor/EditorPage.js';
import { EventsPage } from '../events/EventsPage.js';
import { useOnline } from '../lib/online.js';
import { cn } from '../lib/utils.js';
import { LoopsPage } from '../loops/LoopsPage.js';
import { UpdateToast } from '../pwa/UpdateToast.js';
import { RunInspectorPage } from '../runs/RunInspectorPage.js';
import { RunsPage } from '../runs/RunsPage.js';
import { SettingsPage } from '../settings/SettingsPage.js';

const NAV = [
  { to: '/loops', label: 'Loops' },
  { to: '/runs', label: 'Runs' },
  { to: '/events', label: 'Events' },
  { to: '/settings', label: 'Settings' },
];

function Layout() {
  const online = useOnline();
  const location = useLocation();
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex h-12 items-center gap-4 bg-slate-900 px-4 text-white">
        <span className="font-semibold">GraphGoblin</span>
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn('rounded px-2 py-1 text-sm hover:bg-slate-700', isActive && 'bg-slate-700')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {online ? null : (
        <Alert tone="warn" title="You are offline">
          The app keeps working with what it has; saving, running, and live updates resume when you
          reconnect.
        </Alert>
      )}
      <ApiKeyPanel />
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
      <UpdateToast />
    </div>
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
        <Route path="runs/:runId" element={<RunInspectorPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<p className="p-4 text-sm">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
