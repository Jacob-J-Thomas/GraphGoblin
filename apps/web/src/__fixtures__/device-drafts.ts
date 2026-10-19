import { promisifyRequest } from 'idb-keyval';

/** The IndexedDB keys a loop's device copies live under (`drafts/local-drafts.ts`). */
export function deviceKeys(loopId: string) {
  return { active: loopId, setAside: `${loopId}:set-aside`, archive: `${loopId}:raw-archive` };
}

/**
 * Store a record exactly as an older GraphGoblin build left it in this browser, through
 * IndexedDB itself rather than the current app's typed draft functions.
 */
export async function storeRawDeviceRecord(key: string, value: unknown): Promise<void> {
  const opening = indexedDB.open('graphgoblin', 2);
  opening.onupgradeneeded = () => {
    if (!opening.result.objectStoreNames.contains('drafts'))
      opening.result.createObjectStore('drafts');
  };
  const database = await promisifyRequest(opening);
  try {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(value, key);
    await promisifyRequest(transaction);
  } finally {
    database.close();
  }
}

/** A device draft written by a format-3 build. */
export function formatThreeDraft(
  loopId: string,
  name: string,
  savedAt = '2026-09-01T10:00:00.000Z',
) {
  return {
    loopId,
    definition: {
      schemaVersion: 3,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
    savedAt,
    synced: false,
    baseToken: 'format-3-token',
  };
}
