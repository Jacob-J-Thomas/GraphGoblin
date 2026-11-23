import { z } from 'zod';

const RESERVED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export const CODEX_CONFIG_KEY_MESSAGE =
  'Codex config overrides require every key segment to use letters, digits, "_" or "-", and not __proto__, constructor or prototype.';

/** One unquoted TOML segment admitted by Codex's dotted --config keys. */
export function plainCodexConfigSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment) && !RESERVED_SEGMENTS.has(segment);
}

/** First invalid authored key, retaining dotted keys and array indexes in its field path. */
export function invalidCodexConfigKeyPath(
  value: unknown,
  prefix: (string | number)[] = [],
): (string | number)[] | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = invalidCodexConfigKeyPath(item, [...prefix, index]);
      if (found !== undefined) return found;
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const path = [...prefix, key];
      if (!key.split('.').every(plainCodexConfigSegment)) return path;
      const found = invalidCodexConfigKeyPath(child, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Inspect raw keys alongside the record parser, which discards __proto__. The unknown side only
 * validates: the intersection keeps the record's type and checks original keys in both decoding
 * and encoding, without transforming authored data.
 */
export const CodexConfigOverridesSchema = z.intersection(
  z.record(z.string(), z.unknown()),
  z.unknown().superRefine((value, context) => {
    const path = invalidCodexConfigKeyPath(value);
    if (path !== undefined)
      context.addIssue({ code: 'custom', path, message: CODEX_CONFIG_KEY_MESSAGE });
  }),
);
