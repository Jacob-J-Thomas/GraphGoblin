import { describe, expect, it } from 'vitest';
import { unsafeRegexReason } from './regex-safety.js';

describe('unsafeRegexReason', () => {
  it.each([
    '^[a-z]+$',
    '\\d{3}-\\d{4}',
    '^(foo|bar)+$',
    '^\\w+@\\w+\\.com$',
    '(?:ab)+c',
    '(?<year>\\d{4})-(?<month>\\d{2})',
    '(?=a)b(?!c)(?<=d)e(?<!f)',
    'a{2}b{1,3}c{,}d{',
    '[]a]',
    '[^]x',
    '[\\]]+',
    '\\x41\\u0042\\u{1F600}\\cJ\\p{L}+\\P{N}\\bword\\B',
    '(a?)?',
    '(a{1})+',
    '(?:a|b|c)*',
    '\\',
    '(\\.|x)+',
    '(^a|b)+',
    'x\\p{',
    '(a?b|c)+',
    '(ab?)+',
    '^(?:ab)+$',
    '^(?=a)a+$',
    '^(?:(?:ab|cd)e)+$',
  ])('accepts %s', (pattern) => {
    expect(unsafeRegexReason(pattern)).toBeUndefined();
  });

  it.each([
    ['^(a+)+$', /repetition/],
    ['(\\w*\\s?)*', /repetition/],
    ['((ab)*c){2,}', /repetition/],
    ['((a+))+', /repetition/],
    ['(a|aa)*', /same text/],
    ['(\\d|1)+', /same text/],
    ['^((a|aa))+$', /same text/],
    ['^(?:(?:a|aa))+$', /same text/],
    ['^(?:a?a?)+$', /empty string/],
    ['^(?:a?a)+$', /optional part/],
    ['(a?)+', /empty string/],
    ['^(a{1,}){2,}$', /repetition/],
    ['^(?=(a+)+$).*$', /repetition/],
    ['^(\\p{L}+)+$', /repetition/],
    ['(a|)+', /empty string/],
    ['(x|X)+', /same text/],
    ['(.)\\1', /back-reference/],
    ['(?<n>a)\\k<n>', /back-reference/],
    ['a)', /unbalanced/],
    ['(a', /unbalanced/],
    ['(?<unterminated', /unbalanced/],
  ])('rejects %s', (pattern, reason) => {
    expect(unsafeRegexReason(pattern, pattern === '(x|X)+' ? 'i' : '')).toMatch(reason);
  });

  it('treats case-distinct alternatives as distinct without the i flag', () => {
    expect(unsafeRegexReason('(x|X)+')).toBeUndefined();
    expect(unsafeRegexReason('(x|X)+', 'gi')).toMatch(/same text/);
  });
});
