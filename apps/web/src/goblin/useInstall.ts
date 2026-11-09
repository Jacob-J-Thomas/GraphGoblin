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

/** Match the instructions to the browser actually displaying the pairing page. */
export function installationGuidance(
  userAgent = navigator.userAgent,
  platform = navigator.platform,
  maxTouchPoints = navigator.maxTouchPoints,
): string {
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1))
    return 'On iPhone or iPad, open Goblin in Safari, tap Share, then Add to Home Screen.';
  if (/Android/.test(userAgent))
    return 'In Chrome on Android, open the browser menu and choose Install app or Add to Home screen.';
  if (/Mac/.test(platform) && /Safari/.test(userAgent) && !/Chrome|Chromium|Edg/.test(userAgent))
    return 'In Safari on this Mac, choose File → Add to Dock.';
  if (/Chrome|Chromium|Edg/.test(userAgent))
    return 'Use the install icon in the address bar, or the browser menu’s Install Goblin option.';
  return 'Use your browser’s install option if available, or pair and keep using this browser.';
}
