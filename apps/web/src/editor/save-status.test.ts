import { describe, expect, it } from 'vitest';
import { deviceCopyOf, deviceNotice, saveLabel, saveNotice } from './save-status.js';

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
