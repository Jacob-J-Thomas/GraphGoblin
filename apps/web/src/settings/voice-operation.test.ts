import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearVoiceOperation,
  readVoiceOperation,
  rememberVoiceOperation,
} from './voice-operation.js';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const operation = { operationId: 'fba9f986-08d5-4bc9-b1ad-28f17fecf883', kind: 'probe' as const };

describe('voice operation recovery identity', () => {
  it('retains identity for a read-only lookup across a new setup sheet', () => {
    rememberVoiceOperation(operation);
    expect(readVoiceOperation()).toEqual(operation);
    clearVoiceOperation(operation.operationId);
    expect(readVoiceOperation()).toBeUndefined();
  });
  it('does not clear a newer operation', () => {
    rememberVoiceOperation(operation);
    clearVoiceOperation('different-operation');
    expect(readVoiceOperation()).toEqual(operation);
  });
  it.each(['not json', '{}'])('ignores corrupt recovery state: %s', (value) => {
    sessionStorage.setItem('graphgoblin.voice-operation.v1', value);
    expect(readVoiceOperation()).toBeUndefined();
  });
  it('requires persistence before starting an operation when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readVoiceOperation()).toBeUndefined();
    expect(() => rememberVoiceOperation(operation)).toThrow('blocked');
  });
});
