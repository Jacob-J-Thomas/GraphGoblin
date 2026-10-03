import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './local-drafts.js';

describe('local drafts in IndexedDB', () => {
  it('saves, loads, and clears a draft per loop', async () => {
    expect(await loadLocalDraft('L1')).toBeUndefined();
    await saveLocalDraft({
      loopId: 'L1',
      definition: minimalLoop(),
      savedAt: 'now',
      synced: false,
    });
    expect(await loadLocalDraft('L1')).toMatchObject({
      loopId: 'L1',
      synced: false,
      definition: { name: 'minimal' },
    });
    await clearLocalDraft('L1');
    expect(await loadLocalDraft('L1')).toBeUndefined();
  });
});
