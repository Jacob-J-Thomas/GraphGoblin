import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createStore, get, keys } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import {
  clearLocalDraft,
  loadLocalDraft,
  loadSetAsideDraft,
  saveLocalDraft,
  saveSetAsideDraft,
} from './local-drafts.js';

describe('local drafts in IndexedDB', () => {
  it('preserves a newer valid draft written while an obsolete copy loads', async () => {
    const loopId = 'concurrent-upgrade';
    const definition = {
      ...minimalLoop(),
      settings: { defaults: { model: 'old', harness: 'codex' } },
    };
    await saveLocalDraft({
      loopId,
      definition,
      savedAt: 'before',
      synced: false,
    });
    const loading = loadLocalDraft(loopId);
    await saveLocalDraft({
      loopId,
      definition: { ...minimalLoop(), name: 'newer edit' },
      savedAt: 'after',
      synced: false,
    });
    await loading;
    expect(await loadLocalDraft(loopId)).toMatchObject({ definition: { name: 'newer edit' } });
  });

  it.each(['live', 'set-aside'] as const)('discards an obsolete %s draft on load', async (kind) => {
    const definition = {
      ...minimalLoop(),
      settings: { defaults: { model: 'gpt-6-luna', harness: 'codex' } },
    };
    const draft = { loopId: `obsolete-${kind}`, definition, savedAt: 'now', synced: false };
    const save = kind === 'live' ? saveLocalDraft : saveSetAsideDraft;
    const load = kind === 'live' ? loadLocalDraft : loadSetAsideDraft;
    await save(draft);
    expect(await load(draft.loopId)).toBeUndefined();
    expect(await keys(createStore('graphgoblin', 'drafts'))).not.toContain(
      kind === 'live' ? draft.loopId : `${draft.loopId}:set-aside`,
    );
    expect(
      await get(
        kind === 'live' ? draft.loopId : `${draft.loopId}:set-aside`,
        createStore('graphgoblin', 'drafts'),
      ),
    ).toBeUndefined();
    expect(await load(draft.loopId)).toBeUndefined();
  });

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
