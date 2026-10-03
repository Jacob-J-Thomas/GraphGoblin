import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { describe, expect, it } from 'vitest';
import {
  cn,
  errorMessage,
  fileSlug,
  formatDateTime,
  isOfflineError,
  parseJson,
  prettyJson,
  problemIssues,
} from './utils.js';

describe('utils', () => {
  it('joins classes and formats values', () => {
    expect(cn('a', false, 'b')).toBe('a b');
    expect(formatDateTime(undefined)).toBe('-');
    expect(formatDateTime('not a date')).toBe('not a date');
    expect(formatDateTime('2026-10-02T12:00:00.000Z')).toMatch(/2026/);
    expect(prettyJson(undefined)).toBe('');
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(fileSlug('My Loop!')).toBe('my-loop');
    expect(fileSlug('!!!')).toBe('loop');
  });

  it('describes errors', () => {
    const network = GraphGoblinApiError.network(new Error('down'));
    expect(isOfflineError(network)).toBe(true);
    expect(isOfflineError(new Error('x'))).toBe(false);
    expect(errorMessage(network)).toMatch(/cannot be reached/);
    expect(
      errorMessage(new GraphGoblinApiError({ status: 409, code: 'NO_DRAFT', detail: 'none' })),
    ).toBe('none (NO_DRAFT)');
    expect(errorMessage(new GraphGoblinApiError({ status: 409, code: 'NO_DRAFT' }))).toBe(
      'NO_DRAFT',
    );
    expect(errorMessage(new Error('plain'))).toBe('plain');
    expect(errorMessage('text')).toBe('text');
  });

  it('lists problem issues from 400 and 422 responses', () => {
    const error = new GraphGoblinApiError({
      status: 422,
      code: 'LOOP_INVALID',
      errors: [
        { message: 'a', nodeId: 'n1' },
        { message: 'b', path: '/x' },
        { message: 'c', path: '' },
        'raw',
      ],
    });
    expect(problemIssues(error)).toEqual(['n1: a', '/x: b', 'c', 'raw']);
    expect(problemIssues(new Error('x'))).toEqual([]);
    expect(problemIssues(new GraphGoblinApiError({ status: 400, code: 'X' }))).toEqual([]);
  });

  it('parses JSON safely', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson('{').ok).toBe(false);
  });
});
