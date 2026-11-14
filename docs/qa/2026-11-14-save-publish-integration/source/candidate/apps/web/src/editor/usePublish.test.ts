import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { useEditorStore, type EditorState } from './store.js';
import {
  acknowledgedDraft,
  editorHolds,
  publishNotice,
  sameDefinition,
  type PublishOutcome,
} from './usePublish.js';

/** The same object with its keys, at every depth, in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reversed(item)]),
  );
}

const input: LoopDefinitionInput = { ...minimalLoop(), description: 'mine' };
const stored = LoopDefinitionSchema.parse(input);
const other = LoopDefinitionSchema.parse({ ...input, description: 'theirs' });

function version(n: number, definition: unknown) {
  return {
    id: `version-${n}`,
    loopId: 'loop',
    version: n,
    status: 'published' as const,
    definition,
    createdAt: '2026-11-14T00:00:00.000Z',
  } as Extract<PublishOutcome, { kind: 'published' }>['version'];
}

const fieldErrors = {};
const editor = { definition: input, fieldErrors, revision: 3 };
const base = {
  attempt: { loopId: 'loop', generation: 1, checkFirst: false },
  acknowledged: { definition: stored, token: 'token-mine' },
  arrival: { revision: 3, fieldErrors, holds: true },
};

describe('publish comparisons', () => {
  it('treats omitted defaults and key order as the same draft, and other content as different', () => {
    expect(sameDefinition(reversed(stored), stored)).toBe(true);
    expect(editorHolds({ definition: input, fieldErrors: {} }, reversed(stored))).toBe(true);
    // Same draft row and number, different content: not the same draft.
    expect(sameDefinition(version(1, stored).definition, version(1, other).definition)).toBe(false);
  });

  it('does not hold a version while input is unfinished or the draft does not parse', () => {
    const held = { settings: { maxNodeVisits: { message: 'Enter a number', text: 'x' } } };
    expect(editorHolds({ definition: input, fieldErrors: held }, stored)).toBe(false);
    const invalid = { ...input, nodes: [] } as LoopDefinitionInput;
    expect(editorHolds({ definition: invalid, fieldErrors: {} }, stored)).toBe(false);
  });

  it('takes the server’s answer for the saved revision, else the loaded copy as the server stored it', () => {
    const state = (patch: Partial<EditorState>): EditorState => ({
      ...useEditorStore.getState(),
      definition: input,
      baseToken: 'loaded-token',
      savedRevision: 2,
      ...patch,
    });
    const answer = { revision: 2, definition: other, token: 'saved-token' };
    expect(acknowledgedDraft(state({ acknowledged: answer }))).toEqual({
      definition: other,
      token: 'saved-token',
    });
    // An answer for an earlier revision (a staged voice draft moved the saved revision on).
    expect(acknowledgedDraft(state({ acknowledged: { ...answer, revision: 1 } }))).toEqual({
      definition: stored,
      token: 'loaded-token',
    });
    const invalid = { ...input, nodes: [] } as LoopDefinitionInput;
    expect(acknowledgedDraft(state({ definition: invalid })).definition).toBe(invalid);
  });
});

describe('publish notice', () => {
  const published = (definition: unknown, holds = true, n = 1): PublishOutcome => ({
    ...base,
    arrival: { ...base.arrival, holds },
    kind: 'published',
    version: version(n, definition),
  });

  it('names the returned version, plainly until the editor changes', () => {
    expect(publishNotice(published(stored), editor, { version: 1 })).toEqual({
      tone: 'good',
      text: 'Published version 1.',
      dismissible: false,
    });
    expect(publishNotice(published(stored), { ...editor, revision: 4 }, undefined)).toBeUndefined();
    expect(
      publishNotice(published(stored), { ...editor, fieldErrors: { other: {} } }, undefined),
    ).toBeUndefined();
    expect(publishNotice(published(stored), editor, { version: 2 })?.text).toBe(
      'Published version 1. Version 2 has been published since.',
    );
  });

  it('says later work is not published when the reply arrives after more editing', () => {
    const later = { ...editor, definition: { ...input, description: 'newer' } };
    expect(publishNotice(published(stored, false), later, undefined)).toEqual({
      tone: 'good',
      text: 'Published version 1. It holds the draft saved for this publish; changes made after that are not published.',
      dismissible: true,
    });
    // Undone back to the published content: nothing later remains unpublished.
    expect(publishNotice(published(stored, false), editor, undefined)?.text).toBe(
      'Published version 1. It holds the draft saved for this publish.',
    );
  });

  it('states a different stored draft without naming who saved it', () => {
    expect(publishNotice(published(other, false), editor, undefined)).toEqual({
      tone: 'warn',
      title: 'A different draft was published',
      text: 'Version 1 holds a different stored draft from the draft saved for this publish. This editor’s draft is not published.',
      dismissible: true,
    });
    const matching = { ...editor, definition: { ...input, description: 'theirs' } };
    expect(publishNotice(published(other, false), matching, undefined)?.text).toBe(
      'Version 1 holds a different stored draft from the draft saved for this publish. It matches the editor’s current draft.',
    );
  });

  it('separates nothing to publish from a different current version and a failed check', () => {
    const notPublished = (
      readback: Extract<PublishOutcome, { kind: 'not-published' }>['readback'],
    ) => ({ ...base, kind: 'not-published', readback }) as PublishOutcome;
    const ok = (current: ReturnType<typeof version> | undefined) =>
      ({ ok: true, current, draftToken: 'x' }) as const;
    expect(publishNotice(notPublished(ok(version(1, stored))), editor, undefined)).toEqual({
      tone: 'good',
      text: 'Nothing to publish: version 1 already holds this draft.',
      dismissible: false,
    });
    const later = { ...editor, definition: { ...input, description: 'newer' } };
    const delayed = {
      ...notPublished(ok(version(1, stored))),
      arrival: { ...base.arrival, holds: false },
    } as PublishOutcome;
    expect(publishNotice(delayed, later, undefined)).toEqual({
      tone: 'good',
      text: 'Nothing to publish: version 1 already holds the draft saved for this publish; changes made after that are not published.',
      dismissible: true,
    });
    expect(publishNotice(notPublished(ok(version(2, other))), editor, undefined)).toEqual({
      tone: 'warn',
      title: 'Nothing was published',
      text: 'The server had no draft to publish. Its current version, version 2, holds a different stored draft from the draft saved for this publish.',
      dismissible: true,
    });
    expect(publishNotice(notPublished(ok(undefined)), editor, undefined)?.text).toBe(
      'The server had no draft to publish, and the loop has no published version.',
    );
    expect(
      publishNotice(notPublished({ ok: false, reason: 'Offline.' }), editor, undefined),
    ).toEqual({
      tone: 'warn',
      title: 'Nothing was published',
      text: 'The server had no draft to publish. Checking its current version failed: Offline.',
      dismissible: true,
    });
  });

  it('keeps an unknown outcome unknown unless the check establishes it', () => {
    const unknown = (
      readback: Extract<PublishOutcome, { kind: 'unknown' }>['readback'],
      sent = true,
    ) => ({ ...base, kind: 'unknown', sent, reason: 'No answer.', readback }) as PublishOutcome;
    expect(
      publishNotice(unknown({ ok: true, current: version(1, stored), draftToken: 'x' }), editor, {
        version: 1,
      }),
    ).toEqual({
      tone: 'warn',
      title: 'Publish not confirmed',
      text: 'No answer. A check of the server found that version 1, its current published version, holds the draft saved for this publish.',
      dismissible: true,
    });
    expect(
      publishNotice(unknown({ ok: true, current: undefined, draftToken: 'x' }), editor, undefined)
        ?.text,
    ).toBe(
      'No answer. A check of the server found that the draft saved for this publish is not its current published version. Publish again to retry.',
    );
    expect(
      publishNotice(unknown({ ok: false, reason: 'Still offline.' }), editor, undefined)?.text,
    ).toBe(
      'No answer. Checking the server failed too: Still offline. It is not known whether the draft saved for this publish was published. Publish again checks the server first.',
    );
    expect(
      publishNotice(unknown({ ok: false, reason: 'Still offline.' }, false), editor, undefined)
        ?.text,
    ).toBe(
      'Checking the server before publishing again failed: No answer. Nothing was sent, and it is still not known whether the earlier request published the draft saved for this publish.',
    );
  });
});
