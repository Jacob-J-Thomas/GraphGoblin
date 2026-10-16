import type { UpgradeIssue } from '../upgrade.js';
import { JsonValueSchema } from '@graphgoblin/contracts';

export interface DefinitionReviewItem {
  /** Source-stage JSON pointer plus rule name; never an array index in the generated graph. */
  id: string;
  nodeId: string | null;
  path: string;
  kind: string;
  oldValue: unknown;
  proposedValue: unknown;
  reason: string;
  status: 'automatic' | 'pending' | 'resolved';
  /** SHA-256 of canonical [rule version, entire frozen definition, item without status/hash]. */
  hash: string;
}
export interface DefinitionResolution {
  hash: string;
  action: 'approve' | 'replace';
  value?: unknown;
  reason: string;
}
export type DefinitionResolutions = Record<string, DefinitionResolution>;

export function canonicalReviewValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalReviewValue).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalReviewValue(entry))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

/** Web Crypto hashes data only; no Node dependency, clock, storage or random input. */
export async function definitionReviewHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalReviewValue(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const problem = (code: string, path: string, message: string): UpgradeIssue => ({
  code,
  path,
  message,
});

export class DefinitionReview {
  readonly items: DefinitionReviewItem[] = [];
  readonly issues: UpgradeIssue[] = [];
  private readonly used = new Set<string>();
  constructor(
    private readonly source: unknown,
    private readonly resolutions: DefinitionResolutions,
  ) {}

  async change(
    nodeId: string | null,
    path: string,
    kind: string,
    oldValue: unknown,
    proposedValue: unknown,
    reason: string,
    required = true,
    replaceable = true,
    replacementRequired = false,
  ): Promise<unknown> {
    const item = { id: path + ':' + kind, nodeId, path, kind, oldValue, proposedValue, reason };
    const hash = await definitionReviewHash(['v3-v4-definition-e2-1', this.source, item]);
    const resolution = Object.hasOwn(this.resolutions, item.id)
      ? this.resolutions[item.id]
      : undefined;
    let status: DefinitionReviewItem['status'] = required ? 'pending' : 'automatic';
    let value = proposedValue;
    if (resolution !== undefined) {
      this.used.add(item.id);
      if (
        !required ||
        !resolution ||
        typeof resolution !== 'object' ||
        Object.keys(resolution).some(
          (key) => !['hash', 'action', 'value', 'reason'].includes(key),
        ) ||
        resolution.hash !== hash ||
        typeof resolution.reason !== 'string' ||
        !resolution.reason.trim() ||
        !['approve', 'replace'].includes(resolution.action) ||
        (replacementRequired && resolution.action !== 'replace') ||
        (resolution.action === 'approve' && Object.hasOwn(resolution, 'value')) ||
        (resolution.action === 'replace' &&
          (!replaceable ||
            !Object.hasOwn(resolution, 'value') ||
            !JsonValueSchema.safeParse(resolution.value).success))
      ) {
        this.issues.push(
          problem('V4_RESOLUTION_INVALID', item.path, 'stale or invalid resolution: ' + item.id),
        );
      } else {
        status = 'resolved';
        if (resolution.action === 'replace') value = resolution.value;
      }
    }
    this.items.push({ ...item, hash, status });
    return value;
  }

  finish(): void {
    for (const id of Object.keys(this.resolutions))
      if (!this.used.has(id))
        this.issues.push(problem('V4_RESOLUTION_UNUSED', id, 'unknown or unused resolution'));
  }
}
