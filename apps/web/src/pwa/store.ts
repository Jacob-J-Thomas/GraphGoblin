import { create } from 'zustand';

type ApplyUpdate = () => void | boolean | Promise<void | boolean>;

export interface PwaState {
  /** A new service worker is installed and waiting for the user's go-ahead. */
  needRefresh: boolean;
  /** Activates the waiting worker and reloads. Set together with `needRefresh`. */
  applyUpdate: ApplyUpdate | undefined;
  applying: boolean;
  blockedReason: string | undefined;
  /** The worker precached the shell; the app opens offline from now on. */
  offlineReady: boolean;
  promptUpdate: (applyUpdate: ApplyUpdate) => void;
  setUpdateBlocked: (reason: string) => void;
  setOfflineReady: () => void;
  dismiss: () => void;
  confirm: () => void;
}

export const usePwaStore = create<PwaState>((set, get) => ({
  needRefresh: false,
  applyUpdate: undefined,
  applying: false,
  blockedReason: undefined,
  offlineReady: false,
  promptUpdate: (applyUpdate) =>
    set({ needRefresh: true, applyUpdate, applying: false, blockedReason: undefined }),
  setUpdateBlocked: (blockedReason) => set({ needRefresh: true, blockedReason }),
  setOfflineReady: () => set({ offlineReady: true }),
  dismiss: () => set({ needRefresh: false }),
  confirm: () => {
    if (get().applying) return;
    const apply = get().applyUpdate;
    if (!apply) return;
    set({ applying: true, blockedReason: undefined });
    const finish = (accepted: void | boolean) => {
      if (get().applyUpdate !== apply) return;
      set(
        accepted === false
          ? { applying: false }
          : {
              needRefresh: false,
              applyUpdate: undefined,
              applying: false,
              blockedReason: undefined,
            },
      );
    };
    const failed = () => {
      if (get().applyUpdate === apply)
        set({ applying: false, blockedReason: 'The update could not be checked. Try again.' });
    };
    try {
      const result = apply();
      if (result instanceof Promise) void result.then(finish, failed);
      else finish(result);
    } catch {
      failed();
    }
  },
}));
