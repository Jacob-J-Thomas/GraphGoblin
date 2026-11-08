import { useEffect, useState } from 'react';
import { useStandalone } from './standalone.js';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

/** Browser-owned install prompt. An absent event never becomes a fake install button. */
export function useInstall(): (() => Promise<void>) | undefined {
  const [prompt, setPrompt] = useState<InstallPrompt>();
  const standalone = useStandalone();
  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => setPrompt(undefined);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  if (!prompt || standalone) return undefined;
  return async () => {
    setPrompt(undefined);
    await prompt.prompt();
  };
}
