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
  'name-conflict': 'Not saved: name in use',
};

/**
 * Whether a field holds input the draft does not (#526): unparsed or unapplied JSON, an incomplete
 * number or schedule, kept by the editor's `fieldErrors` for this window's session only. The draft
 * keeps that field's last valid value, and its saves go on without the input.
 */
export function hasHeldInput(fieldErrors: Readonly<Record<string, Readonly<object>>>): boolean {
  return Object.values(fieldErrors).some((scope) => Object.keys(scope).length > 0);
}

/** The save indicator's second segment, and the announcement as held input begins (#526). */
export const HELD_INPUT_LABEL = 'Field input kept in this window only';

/**
 * The save indicator's text for the complete draft. The server's state decides (`saved` is saved
 * to the server, whatever the device storage does); where the server does not hold the edits
 * (`invalid`, `offline`) the device copy says where they are: saved on this device only, kept in
 * this window only, or, while the device write runs, not yet anywhere but here. While a field
 * holds input (`held`), which the indicator shows apart (`HELD_INPUT_LABEL`), not every change is
 * saved: an acknowledged server copy reads "Draft saved", and a device or window copy names the
 * draft. Other states read the same, and nothing claims a save before one (`idle`).
 */
export function saveLabel(state: SaveState, device: DeviceCopy, held = false): string {
  if (state === 'invalid') {
    if (device === 'memory')
      return held ? 'Draft kept in this window only' : 'Kept in this window only';
    if (device === 'writing') return LABELS.pending;
    if (held) return 'Draft saved on this device only';
  }
  if (state === 'offline') {
    if (device === 'memory')
      return held ? 'Offline: draft kept in this window only' : 'Offline: kept in this window only';
    if (device === 'writing') return 'Offline';
    if (held) return 'Offline: draft saved on this device';
  }
  if (state === 'saved' && held) return 'Draft saved';
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
      if (message === 'SYSTEM_CHAT_CONTRACT_INVALID')
        return `Undo the chat trigger change to save to the server.${where ? ` Changes are kept ${where}.` : ''}`;
      return `Fix the schema errors to save to the server.${where ? ` Changes are kept ${where}.` : ''}`;
    case 'offline':
      return where
        ? `Offline: the draft is kept ${where} and saved when the API is back.`
        : 'Offline: the draft is saved when the API is back.';
    case 'error':
      return message;
    // A name refusal has its own notice with its answers (NameConflictNotice), like a draft
    // conflict, rather than a dismissible save notice.
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
