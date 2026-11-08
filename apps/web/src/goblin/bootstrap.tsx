import { StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { applyFont, readStoredFont, useFontAcrossTabs } from '../lib/font.js';
import { applyTheme, readStoredTheme, useThemeAcrossTabs } from '../lib/theme.js';
import { registerPwa } from '../pwa/register.js';
import { UpdateToast } from '../pwa/UpdateToast.js';
import { capturePairingCode } from './connection.js';
import { GoblinApp } from './GoblinApp.js';

function Lifecycle({ registerServiceWorker }: { registerServiceWorker: boolean }) {
  useThemeAcrossTabs();
  useFontAcrossTabs();
  useEffect(() => {
    if (!registerServiceWorker) return;
    const registration = registerPwa({ url: '/goblin/sw.js', scope: '/goblin/' });
    return () => registration.dispose();
  }, [registerServiceWorker]);
  return null;
}

export function bootstrapGoblin(
  container: HTMLElement,
  options: { registerServiceWorker?: boolean } = {},
): Root {
  const initialCode = capturePairingCode();
  applyTheme(readStoredTheme());
  applyFont(readStoredFont());
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <Lifecycle registerServiceWorker={options.registerServiceWorker ?? true} />
      <GoblinApp initialCode={initialCode} />
      <UpdateToast />
    </StrictMode>,
  );
  return root;
}
