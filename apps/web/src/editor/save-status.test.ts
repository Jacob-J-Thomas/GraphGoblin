import { describe, expect, it } from 'vitest';
import {
  deviceCopyOf,
  deviceNotice,
  HELD_INPUT_LABEL,
  hasHeldInput,
  saveLabel,
  saveNotice,
} from './save-status.js';

const blocked = { kind: 'blocked', message: 'Close other GraphGoblin tabs.' } as const;
const failed = { kind: 'failed', message: 'QuotaExceededError' } as const;

describe('save status: the server copy, and where the edits are besides', () => {
  it('finds the device copy from the revision written and the storage state', () => {
    expect(deviceCopyOf(3, 3, undefined)).toBe('device');
    expect(deviceCopyOf(3, 3, blocked)).toBe('device');
    expect(deviceCopyOf(4, 3, undefined)).toBe('writing');
    expect(deviceCopyOf(4, undefined, blocked)).toBe('memory');
  });

  it('labels the three places: this window only, this device only, and the server', () => {
    expect(saveLabel('invalid', 'memory')).toBe('Kept in this window only');
    expect(saveLabel('invalid', 'device')).toBe('Saved on this device only');
    expect(saveLabel('invalid', 'writing')).toBe('Unsaved changes');
    expect(saveLabel('offline', 'memory')).toBe('Offline: kept in this window only');
    expect(saveLabel('offline', 'device')).toBe('Offline: saved on this device');
    expect(saveLabel('offline', 'writing')).toBe('Offline');
    // Saved to the server whatever the device storage does.
    expect(saveLabel('saved', 'memory')).toBe('All changes saved');
    expect(saveLabel('conflict', 'memory')).toBe('Draft changed elsewhere');
  });

  it('finds held field input in any form scope of the editor’s field errors (#526)', () => {
    expect(hasHeldInput({})).toBe(false);
    expect(hasHeldInput({ variables: {} })).toBe(false);
    expect(
      hasHeldInput({
        settings: {},
        'node:infer': { prompt: { message: 'invalid JSON', text: '{', input: 'unparsed text' } },
      }),
    ).toBe(true);
  });

  it('names the complete draft apart from held field input, and never says all changes are saved (#526)', () => {
    expect(saveLabel('saved', 'device', true)).toBe('Draft saved');
    expect(saveLabel('saved', 'memory', true)).toBe('Draft saved');
    expect(saveLabel('invalid', 'device', true)).toBe('Draft saved on this device only');
    expect(saveLabel('invalid', 'memory', true)).toBe('Draft kept in this window only');
    expect(saveLabel('invalid', 'writing', true)).toBe('Unsaved changes');
    expect(saveLabel('offline', 'device', true)).toBe('Offline: draft saved on this device');
    expect(saveLabel('offline', 'memory', true)).toBe('Offline: draft kept in this window only');
    expect(saveLabel('offline', 'writing', true)).toBe('Offline');
    // The other states read as they do without held input; nothing is promoted to saved.
    expect(saveLabel('idle', 'device', true)).toBe('');
    expect(saveLabel('pending', 'device', true)).toBe('Unsaved changes');
    expect(saveLabel('saving', 'device', true)).toBe('Saving…');
    expect(saveLabel('error', 'device', true)).toBe('Save failed');
    expect(saveLabel('conflict', 'memory', true)).toBe('Draft changed elsewhere');
    expect(saveLabel('name-conflict', 'device', true)).toBe('Not saved: name in use');
    for (const state of [
      'idle',
      'pending',
      'saving',
      'saved',
      'invalid',
      'offline',
      'error',
      'conflict',
      'name-conflict',
    ] as const)
      for (const device of ['device', 'writing', 'memory'] as const)
        expect(saveLabel(state, device, true)).not.toMatch(/All changes/);
    // Without held input the labels are as before.
    expect(saveLabel('saved', 'device', false)).toBe('All changes saved');
    expect(HELD_INPUT_LABEL).toBe('Field input kept in this window only');
  });

  it('claims device persistence in a notice only once the device write succeeded', () => {
    expect(saveNotice('invalid', undefined, 'writing')).toBe(
      'Fix the schema errors to save to the server.',
    );
    expect(saveNotice('invalid', undefined, 'memory')).toBe(
      'Fix the schema errors to save to the server. Changes are kept in this window only.',
    );
    expect(saveNotice('offline', undefined, 'device')).toBe(
      'Offline: the draft is kept on this device and saved when the API is back.',
    );
    expect(saveNotice('offline', undefined, 'memory')).toBe(
      'Offline: the draft is kept in this window only and saved when the API is back.',
    );
    expect(saveNotice('offline', undefined, 'writing')).toBe(
      'Offline: the draft is saved when the API is back.',
    );
    expect(saveNotice('error', 'boom', 'device')).toBe('boom');
    expect(saveNotice('saved', undefined, 'memory')).toBeUndefined();
  });

  it('tells the user to close other GraphGoblin windows, with the reason when storage failed', () => {
    expect(deviceNotice(blocked).body).toMatch(/Close other GraphGoblin tabs and windows\./);
    expect(deviceNotice(blocked).body).toMatch(/kept in this window only/);
    expect(deviceNotice(failed).body).toMatch(/failed: QuotaExceededError\./);
    expect(deviceNotice(failed).body).toMatch(/Close other GraphGoblin tabs and windows/);
  });
});
