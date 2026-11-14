import { GraphGoblinApiError, loops, type GraphGoblinClient } from '@graphgoblin/api-client';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApi } from '../api/context.js';
import { refreshLoopAfterWrite } from '../api/queries.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { useEditorStore, type EditorState } from './store.js';
import { CONFLICT_MESSAGE, serializeSave } from './useAutosave.js';

type Version = Awaited<ReturnType<typeof loops.publish>>;

/** One click of Publish, in the editor load that made it. */
export interface PublishAttempt {
  loopId: string;
  generation: number;
  /** The previous attempt's outcome is unknown: read the server before sending another request. */
  checkFirst: boolean;
}

/** The server's copy this attempt publishes: what it stored for this load, and that copy's token. */
export interface Acknowledged {
  definition: unknown;
  token: string | undefined;
}

/** A read of the loop made after a publish answer, or why it failed. */
export type Readback =
  | { ok: true; current: Version | undefined; draftToken: string | undefined }
  | { ok: false; reason: string };

/**
 * What one attempt established. `published`: the server answered with the immutable version it
 * stored. `not-published`: this attempt stored nothing (the server had no draft, or a check found
 * the draft already current). `unknown`: no usable answer (a network failure or a server error),
 * so the server was read back; `sent` is false when even the check before sending failed.
 */
type Answer =
  | { kind: 'published'; version: Version }
  | { kind: 'not-published'; readback: Readback }
  | { kind: 'unknown'; sent: boolean; reason: string; readback: Readback };
export type PublishOutcome = Answer & {
  attempt: PublishAttempt;
  acknowledged: Acknowledged;
  /** The editor when the outcome arrived, and whether it then held the released definition. */
  arrival: { revision: number; fieldErrors: EditorState['fieldErrors']; holds: boolean };
};

/** Equal content, as the server stores definitions: key order and absent fields aside. */
export function sameDefinition(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function hasHeldInput(state: Pick<EditorState, 'fieldErrors'>): boolean {
  return Object.values(state.fieldErrors).some((scope) => Object.keys(scope).length > 0);
}

/**
 * Whether the editor holds exactly `definition`: no unfinished field input, and the same content
 * once the contracts' defaults apply (the server stores the parsed definition, so a local copy that
 * leaves a default out or orders keys differently is still the same draft).
 */
export function editorHolds(
  state: Pick<EditorState, 'definition' | 'fieldErrors'>,
  definition: unknown,
): boolean {
  const parsed = LoopDefinitionSchema.safeParse(state.definition);
  return !hasHeldInput(state) && parsed.success && sameDefinition(parsed.data, definition);
}

/**
 * The server's copy of this load once it holds the current revision: its answer to the accepted
 * save of that revision; when this load made none (a clean load, a reloaded or a staged draft),
 * the loaded copy with its token, parsed as the server parsed it when storing it.
 */
export function acknowledgedDraft(state: EditorState): Acknowledged {
  const { acknowledged } = state;
  if (acknowledged?.revision === state.savedRevision)
    return { definition: acknowledged.definition, token: acknowledged.token };
  const parsed = LoopDefinitionSchema.safeParse(state.definition);
  return { definition: parsed.success ? parsed.data : state.definition, token: state.baseToken };
}

/** Why Publish cannot go ahead in this state, in the editor's existing words. */
function refusal(state: EditorState, saved = true): string | undefined {
  const held = Object.values(state.fieldErrors).flatMap((scope) => Object.values(scope));
  if (held.length > 0)
    return held.every((error) => error.input === 'unapplied JSON')
      ? 'Some fields hold JSON not applied yet; apply or cancel it first.'
      : 'Some fields hold input that is not a valid value yet; complete or discard it first.';
  if (state.conflict) return 'The draft changed on the server; reload it or overwrite it first.';
  if (state.saveState === 'name-conflict')
    return 'Another loop already has this name; choose a different name before publishing.';
  if (!saved) return 'The draft could not be saved; fix the issues below first.';
  return undefined;
}

async function readBack(client: GraphGoblinClient, loopId: string): Promise<Readback> {
  try {
    const detail = await loops.get(client, loopId);
    return { ok: true, current: detail.current, draftToken: detail.draftToken };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

/**
 * One Publish: save, then send `POST /loops/{id}/publish` in this window's queue of the loop's
 * saves, so this editor's own later saves cannot reach the server before it. The request publishes
 * whatever draft the server holds when it admits it; the outcome compares that with the copy the
 * attempt saved. Resolves to undefined, sending nothing, when another load replaced this one first.
 */
async function publishAttempt(
  client: GraphGoblinClient,
  queryClient: QueryClient,
  flush: () => Promise<boolean>,
  attempt: PublishAttempt,
): Promise<PublishOutcome | undefined> {
  const { loopId } = attempt;
  const sameLoad = () => {
    const now = useEditorStore.getState();
    return now.loopId === loopId && now.generation === attempt.generation;
  };
  const early = hasHeldInput(useEditorStore.getState()) && refusal(useEditorStore.getState());
  if (early) throw new Error(early);
  const saved = await flush();
  if (!sameLoad()) return undefined;
  const flushed = refusal(useEditorStore.getState(), saved);
  if (flushed) throw new Error(flushed);
  // Captured now: a later revision is later work, never this attempt's snapshot.
  const acknowledged = acknowledgedDraft(useEditorStore.getState());
  return serializeSave(loopId, async (): Promise<PublishOutcome | undefined> => {
    // Saves queued ahead may have ended this load, met held input, or stopped at a refusal.
    if (!sameLoad()) return undefined;
    const queued = refusal(useEditorStore.getState());
    if (queued) throw new Error(queued);
    let result: Answer | undefined;
    if (attempt.checkFirst) {
      const checked = await readBack(client, loopId);
      if (!checked.ok)
        result = { kind: 'unknown', sent: false, reason: checked.reason, readback: checked };
      else if (
        checked.current &&
        sameDefinition(checked.current.definition, acknowledged.definition)
      )
        result = { kind: 'not-published', readback: checked };
    }
    if (!result) {
      try {
        result = { kind: 'published', version: await loops.publish(client, loopId) };
      } catch (error) {
        if (error instanceof GraphGoblinApiError && error.code === 'NO_DRAFT')
          result = { kind: 'not-published', readback: await readBack(client, loopId) };
        // A definite refusal (LOOP_INVALID, say): the server changed nothing.
        else if (
          error instanceof GraphGoblinApiError &&
          !isOfflineError(error) &&
          error.status < 500
        )
          throw error;
        else
          result = {
            kind: 'unknown',
            sent: true,
            reason: errorMessage(error),
            readback: await readBack(client, loopId),
          };
      }
    }
    void refreshLoopAfterWrite(queryClient, loopId, { published: true });
    const release =
      result.kind === 'published'
        ? result.version
        : result.readback.ok
          ? result.readback.current
          : undefined;
    // The server's next save base no longer descends from this attempt's copy: as for a 409, the
    // editor keeps its work (unsynced on the device) until Reload server draft or Overwrite. Only
    // the same load, still on that copy's token, and not already in a conflict.
    const diverged =
      result.kind === 'published'
        ? !sameDefinition(result.version.definition, acknowledged.definition)
        : result.readback.ok && result.readback.draftToken !== acknowledged.token;
    const now = useEditorStore.getState();
    if (sameLoad() && diverged && !now.conflict && now.baseToken === acknowledged.token) {
      if (now.revision === now.savedRevision)
        useEditorStore.setState({ revision: now.revision + 1 });
      now.setConflict({ serverToken: undefined });
      now.setSaveState('conflict', CONFLICT_MESSAGE);
    }
    const arrived = useEditorStore.getState();
    return {
      ...result,
      attempt,
      acknowledged,
      arrival: {
        revision: arrived.revision,
        fieldErrors: arrived.fieldErrors,
        holds: release !== undefined && editorHolds(arrived, release.definition),
      },
    };
  });
}

/**
 * The editor's Publish (#237). Only the latest attempt is reported, and only to the editor load
 * that made it: a reply that arrives after a reload or in another loop's editor shows nothing
 * there (its cache refresh still happens). `start` ignores a second click while one is running.
 */
export function usePublish(loopId: string, flush: () => Promise<boolean>) {
  const client = useApi();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const mutation = useMutation({
    mutationFn: (attempt: PublishAttempt) => publishAttempt(client, queryClient, flush, attempt),
    onSettled: () => {
      running.current = false;
    },
  });
  const generation = useEditorStore((s) => s.generation);
  const ours =
    mutation.variables?.loopId === loopId && mutation.variables.generation === generation;
  const outcome = ours ? mutation.data : undefined;
  return {
    pending: mutation.isPending,
    outcome,
    error: ours ? mutation.error : null,
    start: () => {
      if (running.current) return;
      running.current = true;
      mutation.mutate({
        loopId,
        generation: useEditorStore.getState().generation,
        checkFirst: outcome?.kind === 'unknown' && !outcome.readback.ok,
      });
    },
  };
}

export interface PublishNoticeText {
  tone: 'good' | 'warn';
  title?: string;
  text: string;
  /** Kept until dismissed; otherwise it describes the editor only until its next change. */
  dismissible: boolean;
}

const SAVED = 'the draft saved for this publish';

/**
 * The words for an outcome, given the editor now and the loop's current version as last read. A
 * confirmation names the immutable version the server returned or read back, never the editor's
 * revision. "Changes made after that" compares the editor's content and unfinished input with that
 * version now, so a reply that arrives after more editing never presents that work as published.
 */
export function publishNotice(
  outcome: PublishOutcome,
  editor: Pick<EditorState, 'definition' | 'fieldErrors' | 'revision'>,
  current: { version: number } | undefined,
): PublishNoticeText | undefined {
  const { acknowledged, arrival } = outcome;
  const release =
    outcome.kind === 'published'
      ? outcome.version
      : outcome.readback.ok
        ? outcome.readback.current
        : undefined;
  const holdsSaved =
    release !== undefined && sameDefinition(release.definition, acknowledged.definition);
  const since =
    release && current && current.version > release.version
      ? ` Version ${current.version} has been published since.`
      : '';
  const later =
    release && !editorHolds(editor, release.definition)
      ? '; changes made after that are not published.'
      : '.';
  if (outcome.kind === 'unknown') {
    const title = 'Publish not confirmed';
    if (!outcome.sent)
      return {
        tone: 'warn',
        title,
        text: `Checking the server before publishing again failed: ${outcome.reason} Nothing was sent, and it is still not known whether the earlier request published ${SAVED}.`,
        dismissible: true,
      };
    if (!outcome.readback.ok)
      return {
        tone: 'warn',
        title,
        text: `${outcome.reason} Checking the server failed too: ${outcome.readback.reason} It is not known whether ${SAVED} was published. Publish again checks the server first.`,
        dismissible: true,
      };
    return {
      tone: 'warn',
      title,
      text: holdsSaved
        ? `${outcome.reason} A check of the server found that version ${release.version}, its current published version, holds ${SAVED}${later}${since}`
        : `${outcome.reason} A check of the server found that ${SAVED} is not its current published version. Publish again to retry.`,
      dismissible: true,
    };
  }
  if (outcome.kind === 'not-published' && !outcome.readback.ok)
    return {
      tone: 'warn',
      title: 'Nothing was published',
      text: `The server had no draft to publish. Checking its current version failed: ${outcome.readback.reason}`,
      dismissible: true,
    };
  if (!holdsSaved)
    return outcome.kind === 'published'
      ? {
          tone: 'warn',
          title: 'A different draft was published',
          text: `Version ${outcome.version.version} holds a different stored draft from ${SAVED}. ${editorHolds(editor, outcome.version.definition) ? 'It matches the editor’s current draft.' : 'This editor’s draft is not published.'}${since}`,
          dismissible: true,
        }
      : {
          tone: 'warn',
          title: 'Nothing was published',
          text: release
            ? `The server had no draft to publish. Its current version, version ${release.version}, holds a different stored draft from ${SAVED}.${since}`
            : `The server had no draft to publish, and the loop has no published version.`,
          dismissible: true,
        };
  const published = outcome.kind === 'published';
  // The editor held this version when the answer came: say so plainly, until the editor changes.
  if (arrival.holds) {
    const unchanged =
      editor.revision === arrival.revision && editor.fieldErrors === arrival.fieldErrors;
    const text = published
      ? `Published version ${release.version}.`
      : `Nothing to publish: version ${release.version} already holds this draft.`;
    return unchanged ? { tone: 'good', text: `${text}${since}`, dismissible: false } : undefined;
  }
  return {
    tone: 'good',
    text: published
      ? `Published version ${release.version}. It holds ${SAVED}${later}${since}`
      : `Nothing to publish: version ${release.version} already holds ${SAVED}${later}${since}`,
    dismissible: true,
  };
}
