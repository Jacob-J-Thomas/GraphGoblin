import { describe, expect, it, vi } from 'vitest';
import {
  beginPairing,
  completePairing,
  CredentialStorageError,
  DEVICE_CREDENTIAL_KEY,
  forgetDevice,
  GOBLIN_CHAT_STORAGE_KEY,
  readDeviceRecord,
} from './credentials.js';

describe('peripheral credentials', () => {
  it('stores a 256-bit token and stable claim identity atomically before use, preserving opaque code case', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const pending = beginPairing('  Ab_cD-Xy  ', '  Kitchen tablet  ');
    expect(pending).toMatchObject({ kind: 'pending', code: 'Ab_cD-Xy', label: 'Kitchen tablet' });
    expect(pending.deviceToken).toMatch(/^ggd_[\w-]{43}$/);
    expect(pending.claimId).toMatch(/^[\da-f-]{36}$/);
    expect(readDeviceRecord()).toEqual(pending);
    expect(beginPairing('Ab_cD-Xy', 'Changed name')).toEqual(pending);
    expect(get.mock.calls.every(([key]) => key === DEVICE_CREDENTIAL_KEY)).toBe(true);
    const different = beginPairing('ab_cD-Xy', 'Phone');
    expect(different.claimId).not.toBe(pending.claimId);
    expect(different.deviceToken).not.toBe(pending.deviceToken);
  });

  it('completes the saved connection and removes enrollment code and claim identity', () => {
    const pending = beginPairing('code', 'Phone');
    const device = completePairing(pending, {
      deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      label: 'Phone',
    });
    expect(readDeviceRecord()).toEqual(device);
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).not.toContain('claimId');
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).not.toContain('"code"');
  });

  it.each([null, 'invalid-json', '{}', '{"kind":"device","deviceToken":"owner-key"}'])(
    'treats absent/corrupt data as unpaired (%s)',
    (raw) => {
      if (raw !== null) localStorage.setItem(DEVICE_CREDENTIAL_KEY, raw);
      expect(readDeviceRecord()).toBeUndefined();
    },
  );

  it('refuses pairing before network use if persistence fails and keeps pending identity after failed completion', () => {
    const pending = beginPairing('code', 'Phone');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => beginPairing('new-code', 'Phone')).toThrow(CredentialStorageError);
    expect(() =>
      completePairing(pending, { deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' }),
    ).toThrow(CredentialStorageError);
    set.mockRestore();
    expect(readDeviceRecord()).toEqual(pending);
  });

  it('reports inaccessible browser storage without including credentials', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('secret');
    });
    expect(() => readDeviceRecord()).toThrow('Allow site storage');
    expect(() => beginPairing('secret-code', 'Phone')).toThrow(CredentialStorageError);
  });

  it('signs out locally and clears only its own draft and credential', () => {
    beginPairing('code', 'Phone');
    localStorage.setItem('owner-key', 'admin-secret');
    sessionStorage.setItem(GOBLIN_CHAT_STORAGE_KEY, 'draft');
    sessionStorage.setItem('owner-draft', 'keep');
    forgetDevice();
    expect(readDeviceRecord()).toBeUndefined();
    expect(sessionStorage.getItem(GOBLIN_CHAT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('owner-key')).toBe('admin-secret');
    expect(sessionStorage.getItem('owner-draft')).toBe('keep');
  });

  it('reports failed sign-out storage removal', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => forgetDevice(storage)).toThrow(CredentialStorageError);
  });

  it('handles browsers that deny access to the storage objects themselves', () => {
    const pending = beginPairing('code', 'Phone');
    const local = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => readDeviceRecord()).toThrow(CredentialStorageError);
    expect(() => beginPairing('new-code', 'Phone')).toThrow(CredentialStorageError);
    expect(() =>
      completePairing(pending, { deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', label: 'Phone' }),
    ).toThrow(CredentialStorageError);
    local.mockRestore();
    const drafts = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => forgetDevice()).toThrow(CredentialStorageError);
    drafts.mockRestore();
  });
});
