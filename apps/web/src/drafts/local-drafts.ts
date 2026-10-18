import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '@graphgoblin/contracts';
import type { DecisionRoutes } from '../editor/decision-route-edges.js';
import { del, get, update, promisifyRequest, type UseStore } from 'idb-keyval';

/** Cannot match a server content hash; converted device edits need explicit reconciliation. */
export const UNRECONCILED_DEVICE_TOKEN = 'unreconciled-device-format';

/**
 * Unsaved editor drafts mirrored to IndexedDB, so a reload or an offline spell never loses work.
 * The server draft stays the source of truth once an autosave succeeds.
 */
export interface LocalDraft {
  loopId: string;
  definition: LoopDefinitionInput;
  /** Device-only row ownership, needed when an unfinished ID differs from its connected port. */
  decisionRoutes?: DecisionRoutes;
  savedAt: string;
  /** True once the server accepted this exact definition. */
  synced: boolean;
  /** The server draft token this copy is based on, sent as `If-Match` when it is saved. */
  baseToken?: string;
  /** Present only when a legacy local copy was preserved because safe conversion was impossible. */
  migrationIssues?: { code: string; path: string; message: string; id?: string; hash?: string }[];
}

/** Latest work in this window. Presence in memory does not imply a durable write succeeded. */
export interface CachedDraft {
  draft: LocalDraft;
  durable: boolean;
}
const latest = new Map<string, CachedDraft>();
const writes = new Map<string, Promise<void>>();

export function rememberLocalDraft(draft: LocalDraft): CachedDraft {
  const entry = { draft, durable: false };
  latest.set(draft.loopId, entry);
  return entry;
}

export function cachedLocalDraft(loopId: string): CachedDraft | undefined {
  const cached = latest.get(loopId);
  return cached?.draft.definition.schemaVersion === CURRENT_DEFINITION_FORMAT ? cached : undefined;
}

/**
 * Why device storage refused its last operation. `blocked`: another GraphGoblin window still holds
 * an older version's connection, so the store upgrade cannot run (it clears by itself when that
 * window lets go); `failed`: anything else (it clears when an operation succeeds again).
 */
export interface DeviceStorageProblem {
  kind: 'blocked' | 'failed';
  message: string;
}

/** How long an upgrade may wait for other windows before device storage counts as blocked. */
const BLOCKED_GRACE_MS = 3000;

const BLOCKED_MESSAGE = 'Close other GraphGoblin tabs and windows so device drafts can be saved.';

class DraftStoreBlockedError extends Error {}

let database: Promise<IDBDatabase> | undefined;
let problem: DeviceStorageProblem | undefined;
const listeners = new Set<() => void>();

function report(next: DeviceStorageProblem | undefined): void {
  if (problem?.kind === next?.kind && problem?.message === next?.message) return;
  problem = next;
  for (const listener of listeners) listener();
}

/** The device storage's state now: undefined while it works (or before it was first used). */
export function deviceStorageProblem(): DeviceStorageProblem | undefined {
  return problem;
}

/**
 * Called whenever the device storage's state changes: an operation fails, one succeeds after a
 * failure, or the upgrade other windows were blocking completes. Returns the unsubscribe.
 */
export function subscribeDeviceStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('graphgoblin', 2);
    let blockedTimeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    request.onblocked = () => {
      blockedTimeout ??= setTimeout(() => {
        timedOut = true;
        reject(new DraftStoreBlockedError(BLOCKED_MESSAGE));
      }, BLOCKED_GRACE_MS);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      // Preserve every device copy; format conversion happens per draft, after archival.
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
    };
    request.onsuccess = () => {
      clearTimeout(blockedTimeout);
      if (!timedOut) return resolve(request.result);
      // The other windows let go after the grace: the store is available from now on, and its
      // users hear so at once rather than on their next write.
      connect(Promise.resolve(request.result));
      report(undefined);
    };
    request.onerror = () => {
      clearTimeout(blockedTimeout);
      const error = request.error ?? new Error('The device-draft database could not be opened.');
      if (!timedOut) return reject(error);
      // The upgrade that was blocked failed after all: the next operation opens again.
      database = undefined;
      report({ kind: 'failed', message: error.message });
    };
  });
}

/** Use `opening` as the connection, and forget it when it closes or fails. */
function connect(opening: Promise<IDBDatabase>): void {
  database = opening;
  void opening.then(
    (db) => {
      db.onversionchange = () => {
        db.close();
        if (database === opening) database = undefined;
      };
      db.onclose = () => {
        if (database === opening) database = undefined;
      };
    },
    (error: unknown) => {
      // While blocked, operations keep this rejection and fail at once, until the pending upgrade
      // completes and replaces it (above). After any other failure the next operation opens again.
      if (!(error instanceof DraftStoreBlockedError) && database === opening) database = undefined;
    },
  );
}

function draftStore(): UseStore {
  if (!database) connect(openDraftDatabase());
  const connection = database!;
  return (mode, callback) =>
    connection.then((db) => callback(db.transaction('drafts', mode).objectStore('drafts')));
}

/**
 * Run one operation on the store and keep the device storage's state up to date: a success means
 * it works, a failure says why (`deviceStorageProblem`). The failure is rethrown.
 */
async function run<T>(operation: (store: UseStore) => Promise<T>): Promise<T> {
  try {
    const result = await operation(draftStore());
    report(undefined);
    return result;
  } catch (error) {
    report(
      error instanceof DraftStoreBlockedError
        ? { kind: 'blocked', message: error.message }
        : {
            kind: 'failed',
            message: error instanceof Error ? error.message || error.name : String(error),
          },
    );
    throw error;
  }
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  const entry = rememberLocalDraft(draft);
  // Even a slow or refused write leaves the newest copy available for warm navigation.
  const writing = (writes.get(draft.loopId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => saveDraft(draft.loopId, draft));
  writes.set(draft.loopId, writing);
  try {
    await writing;
    entry.durable = true;
  } finally {
    if (writes.get(draft.loopId) === writing) writes.delete(draft.loopId);
  }
}

/** Also protects copies first discovered after a blocked database upgrade finishes. */
async function preserveLegacyDraft(
  key: string,
  definition: LoopDefinitionInput,
): Promise<LocalDraft | undefined> {
  if (definition.schemaVersion !== CURRENT_DEFINITION_FORMAT) return;
  return run(async (store) => {
    const original = await get<LocalDraft>(key, store);
    if (!original || original.definition.schemaVersion === CURRENT_DEFINITION_FORMAT) return;
    await saveArchivedDraft(original);
    const copies = await get<LocalDraft[]>(archiveKey(original.loopId), store);
    if (!copies?.some((copy) => JSON.stringify(copy) === JSON.stringify(original)))
      throw new Error('The original device copy could not be verified.');
    return original;
  });
}

/** The check and replacement run in one write transaction; a concurrent old edit must survive. */
function requirePreserved(
  local: LocalDraft | undefined,
  original: LocalDraft | undefined,
  definition: LoopDefinitionInput,
): void {
  if (
    definition.schemaVersion === CURRENT_DEFINITION_FORMAT &&
    local &&
    local.definition.schemaVersion !== CURRENT_DEFINITION_FORMAT &&
    JSON.stringify(local) !== JSON.stringify(original)
  )
    throw new Error('The device copy changed while being preserved. Reload before replacing it.');
}

async function saveDraft(key: string, draft: LocalDraft): Promise<void> {
  const original = await preserveLegacyDraft(key, draft.definition);
  await run((store) =>
    update<LocalDraft>(
      key,
      (local) => {
        requirePreserved(local, original, draft.definition);
        return draft;
      },
      store,
    ),
  );
}

export async function loadLocalDraft(loopId: string): Promise<LocalDraft | undefined> {
  const before = latest.get(loopId);
  const draft = await loadDraft(loopId);
  if (
    !before &&
    !latest.has(loopId) &&
    draft?.definition?.schemaVersion === CURRENT_DEFINITION_FORMAT
  )
    latest.set(loopId, { draft, durable: true });
  return draft;
}

/** A blocked store reads as no copy, so the editor opens on the server's; the state says why. */
async function loadDraft(key: string): Promise<LocalDraft | undefined> {
  try {
    return await run((store) => get<LocalDraft>(key, store));
  } catch (error) {
    if (error instanceof DraftStoreBlockedError) return undefined;
    throw error;
  }
}

/** A missing or conversion-only token cannot establish descent from the accepted save. */
function sharesSaveBase(draft: LocalDraft, baseToken: string | undefined): boolean {
  return (
    baseToken !== undefined &&
    baseToken !== UNRECONCILED_DEVICE_TOKEN &&
    draft.baseToken === baseToken
  );
}

/**
 * Record that the server accepted `definition` with `token`, in one IndexedDB transaction so a
 * concurrent mirror write is never lost. A device copy of that exact definition becomes synced. A
 * newer device copy advances only if its base matches this save's request base and its definition
 * and decision routes match this editor's latest mirror inside the transaction. Unread work keeps
 * its base even when it shares the request token; converted work keeps its mandatory overwrite token.
 */
export async function recordServerSave(
  loopId: string,
  definition: LoopDefinitionInput,
  token: string,
  baseToken: string | undefined,
): Promise<void> {
  const cached = latest.get(loopId);
  const differs =
    cached !== undefined && JSON.stringify(cached.draft.definition) !== JSON.stringify(definition);
  const rebase = differs && sharesSaveBase(cached.draft, baseToken);
  const draft: LocalDraft = differs
    ? rebase
      ? { ...cached.draft, baseToken: token }
      : cached.draft
    : { loopId, definition, savedAt: new Date().toISOString(), synced: true, baseToken: token };
  const entry = { draft, durable: false };
  latest.set(loopId, entry);
  let stored: LocalDraft | undefined;
  const writing = (writes.get(loopId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      stored = await persistServerSave(loopId, definition, token, baseToken);
    });
  writes.set(loopId, writing);
  try {
    await writing;
    entry.durable =
      (!differs || rebase) &&
      stored !== undefined &&
      draft.baseToken === stored.baseToken &&
      JSON.stringify(draft.definition) === JSON.stringify(stored.definition) &&
      JSON.stringify(draft.decisionRoutes) === JSON.stringify(stored.decisionRoutes);
  } finally {
    if (writes.get(loopId) === writing) writes.delete(loopId);
  }
}

async function persistServerSave(
  loopId: string,
  definition: LoopDefinitionInput,
  token: string,
  baseToken: string | undefined,
): Promise<LocalDraft> {
  const original = await preserveLegacyDraft(loopId, definition);
  const synced: LocalDraft = {
    loopId,
    definition,
    savedAt: new Date().toISOString(),
    synced: true,
    baseToken: token,
  };
  let stored = synced;
  await run((store) =>
    update<LocalDraft>(
      loopId,
      (local) => {
        requirePreserved(local, original, definition);
        // A shared base alone cannot identify this editor's work. A queued mirror can also
        // supersede the copy seen when the save started, so inspect the latest cache here.
        const mirror = latest.get(loopId)?.draft;
        const isOwnMirror =
          mirror !== undefined &&
          JSON.stringify(local?.definition) === JSON.stringify(mirror.definition) &&
          JSON.stringify(local?.decisionRoutes) === JSON.stringify(mirror.decisionRoutes);
        stored =
          local && JSON.stringify(local.definition) !== JSON.stringify(definition)
            ? sharesSaveBase(local, baseToken) && isOwnMirror
              ? { ...local, baseToken: token }
              : local
            : synced;
        return stored;
      },
      store,
    ),
  );
  return stored;
}

export async function clearLocalDraft(loopId: string): Promise<void> {
  await run(async (store) => {
    await del(loopId, store);
    await del(setAsideKey(loopId), store);
    await del(archiveKey(loopId), store);
  });
  latest.delete(loopId);
}

/** Compare content and metadata, excluding the raw notice's generated migration issues. */
function sameCopy(copy: LocalDraft, expected: LocalDraft): boolean {
  return (
    copy.loopId === expected.loopId &&
    copy.savedAt === expected.savedAt &&
    copy.synced === expected.synced &&
    copy.baseToken === expected.baseToken &&
    JSON.stringify(copy.definition) === JSON.stringify(expected.definition) &&
    JSON.stringify(copy.decisionRoutes) === JSON.stringify(expected.decisionRoutes)
  );
}

async function clearDraft(key: string, expected?: LocalDraft): Promise<void> {
  if (!expected) return run((store) => del(key, store));
  await run((store) =>
    store('readwrite', (items) => {
      const reading = items.get(key);
      let changed = false;
      reading.onsuccess = () => {
        const copy = reading.result as LocalDraft | undefined;
        if (copy && !sameCopy(copy, expected)) {
          changed = true;
          items.transaction.abort();
        } else items.delete(key);
      };
      return promisifyRequest(items.transaction).catch((error: unknown) => {
        throw changed
          ? new Error('The device copy changed before removal. Reload before replacing it.')
          : error;
      });
    }),
  );
}

/** Remove only the verified live mirror; a concurrent edit is never cleared. */
export async function clearActiveLocalDraft(loopId: string, expected?: LocalDraft): Promise<void> {
  await clearDraft(loopId, expected);
  const cached = latest.get(loopId);
  if (!expected || (cached && sameCopy(cached.draft, expected))) latest.delete(loopId);
}

/**
 * A device copy set aside because the server had a newer draft. Kept under its own key, apart
 * from the live mirror that later edits overwrite, until the user restores or discards it.
 */
function setAsideKey(loopId: string): string {
  return `${loopId}:set-aside`;
}

export async function saveSetAsideDraft(draft: LocalDraft): Promise<void> {
  await saveDraft(setAsideKey(draft.loopId), draft);
}

export async function loadSetAsideDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(setAsideKey(loopId));
}

export async function clearSetAsideDraft(loopId: string, expected?: LocalDraft): Promise<void> {
  await clearDraft(setAsideKey(loopId), expected);
}

/** Raw device copies that could not be converted safely, kept outside the live autosave key. */
function archiveKey(loopId: string): string {
  return `${loopId}:raw-archive`;
}

export async function loadArchivedDrafts(loopId: string): Promise<LocalDraft[]> {
  return (await loadDrafts(archiveKey(loopId))) ?? [];
}

async function loadDrafts(key: string): Promise<LocalDraft[] | undefined> {
  try {
    return await run((store) => get<LocalDraft[]>(key, store));
  } catch (error) {
    if (error instanceof DraftStoreBlockedError) return undefined;
    throw error;
  }
}

export async function saveArchivedDraft(draft: LocalDraft): Promise<void> {
  await run((store) =>
    update<LocalDraft[]>(
      archiveKey(draft.loopId),
      (copies) => {
        const current = copies ?? [];
        const duplicate = current.some((copy) => JSON.stringify(copy) === JSON.stringify(draft));
        return duplicate ? current : [...current, draft];
      },
      store,
    ),
  );
}

export async function clearArchivedDraft(loopId: string, draft: LocalDraft): Promise<void> {
  await run((store) =>
    update<LocalDraft[]>(
      archiveKey(loopId),
      (copies) => (copies ?? []).filter((copy) => !sameCopy(copy, draft)),
      store,
    ),
  );
}
