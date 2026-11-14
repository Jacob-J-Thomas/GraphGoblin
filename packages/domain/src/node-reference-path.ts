export type NodeMap = 'outputs' | 'gates' | 'counters.nodeVisits';

type ReferenceSpelling = 'bare' | 'jsonata-name' | 'single-quoted' | 'double-quoted' | 'backtick';

export interface TextSpan {
  readonly start: number;
  readonly end: number;
  readonly spelling: ReferenceSpelling;
}

export interface ReferenceSite {
  readonly map: NodeMap;
  readonly id: string;
  readonly optional: boolean;
  readonly span: TextSpan;
}

export function referenceSpelling(quote: string | undefined): ReferenceSpelling {
  switch (quote) {
    case "'":
      return 'single-quoted';
    case '"':
      return 'double-quoted';
    case '`':
      return 'backtick';
    default:
      return 'bare';
  }
}

/** A slug contains no quote characters. Quote JSONata punctuation and reserved names. */
export function spellReference(id: string, spelling: ReferenceSpelling): string {
  switch (spelling) {
    case 'bare':
      return id;
    case 'single-quoted':
      return "'" + id + "'";
    case 'double-quoted':
      return '"' + id + '"';
    case 'backtick':
      return '`' + id + '`';
    case 'jsonata-name':
      return /^[A-Za-z][A-Za-z0-9_]*$/.test(id) &&
        !['true', 'false', 'null', 'and', 'or', 'in'].includes(id)
        ? id
        : JSON.stringify(id);
  }
}

export interface SourceReferences {
  sites: ReferenceSite[];
  uncertain: boolean;
}

/** The view belongs to the current loop, possibly at a nested or injected root. */
export type ReferenceScope = 'thread' | 'heartbeat' | 'parent' | 'binding';

export interface MapAccess {
  map: NodeMap;
  keyIndex: number;
}

export function nodeMap(path: readonly unknown[], offset: number): MapAccess | undefined {
  switch (path[offset]) {
    case 'outputs':
      return { map: 'outputs', keyIndex: offset + 1 };
    case 'gates':
      return { map: 'gates', keyIndex: offset + 1 };
    case 'counters':
      if (path[offset + 1] === 'nodeVisits') {
        return { map: 'counters.nodeVisits', keyIndex: offset + 2 };
      }
  }
  return undefined;
}

export function threadOffset(path: readonly unknown[], scope: ReferenceScope): number | undefined {
  if (scope === 'thread') return 0;
  if (scope === 'heartbeat' && path[0] === 'thread') return 1;
  if (scope === 'parent' && path[0] === 'parent') return 1;
  return undefined;
}
