import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { describe, expect, it } from 'vitest';
import {
  importedLoopName,
  LOOP_NAME_RULE,
  loopNameConflict,
  loopNameKey,
  sameLoopName,
} from './loop-names.js';

const refusal = (extensions: Record<string, unknown>, code = 'LOOP_NAME_CONFLICT') =>
  new GraphGoblinApiError({ status: 409, code, detail: 'taken', ...extensions });

describe('loop names', () => {
  it('compares names as the API does: trimmed, collapsed whitespace, default lowercase', () => {
    expect(loopNameKey('  Écho \t Board\n')).toBe('écho board');
    expect(sameLoopName('Écho  Board', ' écho\tboard ')).toBe(true);
    expect(sameLoopName('Nightly triage', 'Nightly-triage')).toBe(false);
    // No Unicode normalization or full case folding (ADR-0073).
    expect(sameLoopName('Straße', 'STRASSE')).toBe(false);
    expect(sameLoopName('é', 'é')).toBe(false);
  });

  it('reads only the exact code and a non-blank string suggestion', () => {
    expect(loopNameConflict(refusal({ suggestedName: 'Board copy' }), 'Board')).toEqual({
      name: 'Board',
      suggestedName: 'Board copy',
    });
    expect(loopNameConflict(refusal({ suggestedName: 7 }), 'Board')).toEqual({
      name: 'Board',
      suggestedName: undefined,
    });
    expect(loopNameConflict(refusal({ suggestedName: '  ' }), undefined)).toEqual({
      name: undefined,
      suggestedName: undefined,
    });
    expect(loopNameConflict(refusal({ draftToken: 't' }, 'DRAFT_CONFLICT'), 'Board')).toBe(
      undefined,
    );
    expect(loopNameConflict(refusal({}, 'LOOP_NAME_INVALID'), 'Board')).toBe(undefined);
    expect(loopNameConflict(new Error('LOOP_NAME_CONFLICT'), 'Board')).toBe(undefined);
    expect(LOOP_NAME_RULE).toMatch(/letter case or spacing/);
  });

  it('finds the name an export or a bare definition asks for', () => {
    expect(importedLoopName({ format: 'graphgoblin-loop', loop: { name: 'Exported' } })).toBe(
      'Exported',
    );
    expect(importedLoopName({ name: 'Bare', nodes: [] })).toBe('Bare');
    expect(importedLoopName({ loop: { nodes: [] } })).toBe(undefined);
    expect(importedLoopName({ loop: null, name: 3 })).toBe(undefined);
  });
});
