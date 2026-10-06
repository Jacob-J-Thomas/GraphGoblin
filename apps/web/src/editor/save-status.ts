import { useSyncExternalStore } from 'react';
import {
  deviceStorageProblem,
  subscribeDeviceStorage,
  type DeviceStorageProblem,
} from '../drafts/local-drafts.js';
import type { SaveState } from './store.js';

/**
 * Where the current revision is kept besides the server: `device` once its IndexedDB mirror write
 * succeeded, `memory` when device storage refused it (blocked by another window, or failing), so
 * it lives in this window only, and `writing` while the device write is under way.
 */
export type DeviceCopy = 'device' | 'writing' | 'memory';

export function deviceCopyOf(
  revision: number,
  deviceRevision: number | undefined,
  problem: DeviceStorageProblem | undefined,
): DeviceCopy {
  if (deviceRevision === revision) return 'device';
  return problem ? 'memory' : 'writing';
}

/** The device storage's state, following its changes. */
export function useDeviceStorageProblem(): DeviceStorageProblem | undefined {
  return useSyncExternalStore(subscribeDeviceStorage, deviceStorageProblem);
}

const LABELS: Record<SaveState, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'All changes saved',
  invalid: 'Saved on this device only',
  offline: 'Offline: saved on this device',
  error: 'Save failed',
  conflict: 'Draft changed elsewhere',
};

/**
 * The save indicator's text. The server's state decides (`saved` is saved to the server, whatever
 * the device storage does); where the server does not hold the edits (`invalid`, `offline`) the
 * device copy says where they are: saved on this device only, kept in this window only, or, while
 * the device write runs, not yet anywhere but here.
 */
export function saveLabel(state: SaveState, device: DeviceCopy): string {
  if (state === 'invalid') {
    if (device === 'memory') return 'Kept in this window only';
    if (device === 'writing') return LABELS.pending;
  }
  if (state === 'offline') {
    if (device === 'memory') return 'Offline: kept in this window only';
    if (device === 'writing') return 'Offline';
  }
  return LABELS[state];
}

/**
 * The save notice (and the indicator's tooltip) for a state that needs one: why the server does
 * not hold the edits, and where they are instead, said only once the device write that keeps them
 * succeeded or failed. `message` is the server's reason for a failed save.
 */
export function saveNotice(
  state: SaveState,
  message: string | undefined,
  device: DeviceCopy,
): string | undefined {
  const where =
    device === 'device' ? 'on this device' : device === 'memory' ? 'in this window only' : '';
  switch (state) {
    case 'invalid':
      return `Fix the schema errors to save to the server.${where ? ` Changes are kept ${where}.` : ''}`;
    case 'offline':
      return where
        ? `Offline: the draft is kept ${where} and saved when the API is back.`
        : 'Offline: the draft is saved when the API is back.';
    case 'error':
      return message;
    default:
      return undefined;
  }
}

/** The device storage notice: what went wrong, what it means, and what to do. */
export function deviceNotice(problem: DeviceStorageProblem): { title: string; body: string } {
  return problem.kind === 'blocked'
    ? {
        title: 'Changes are not kept on this device',
        body: 'Another GraphGoblin tab or window is still open on an older version and blocks this device’s draft storage. Close other GraphGoblin tabs and windows. Until then, changes the server has not saved are kept in this window only, and closing it loses them.',
      }
    : {
        title: 'Changes are not kept on this device',
        body: `This device’s draft storage failed: ${problem.message}. Changes the server has not saved are kept in this window only, and closing it loses them. Close other GraphGoblin tabs and windows; if it keeps failing, reload.`,
      };
}
