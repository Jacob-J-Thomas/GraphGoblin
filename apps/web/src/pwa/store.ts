import { create } from 'zustand';

export interface PwaState {
  /** A new service worker is installed and waiting for the user's go-ahead. */
  needRefresh: boolean;
  /** Activates the waiting worker and reloads. Set together with `needRefresh`. */
  applyUpdate: (() => void) | undefined;
  /** The worker precached the shell; the app opens offline from now on. */
  offlineReady: boolean;
  promptUpdate: (applyUpdate: () => void) => void;
  setOfflineReady: () => void;
  dismiss: () => void;
  confirm: () => void;
}

export const usePwaStore = create<PwaState>((set, get) => ({
  needRefresh: false,
  applyUpdate: undefined,
  offlineReady: false,
  promptUpdate: (applyUpdate) => set({ needRefresh: true, applyUpdate }),
  setOfflineReady: () => set({ offlineReady: true }),
  dismiss: () => set({ needRefresh: false }),
  confirm: () => {
    const apply = get().applyUpdate;
    set({ needRefresh: false, applyUpdate: undefined });
    apply?.();
  },
}));
