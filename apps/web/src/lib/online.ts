import { useSyncExternalStore } from 'react';
import { useReachability } from './reachability.js';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Whether the browser believes it is online. Updates on `online` and `offline` events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}

/** Banner reason; browser connectivity remains independent of API reachability. */
export function useConnectionStatus(): 'online' | 'offline' | 'api-unreachable' {
  const online = useOnline();
  const apiReachable = useReachability((state) => state.apiReachable || state.reconnecting);
  return !online ? 'offline' : apiReachable ? 'online' : 'api-unreachable';
}
