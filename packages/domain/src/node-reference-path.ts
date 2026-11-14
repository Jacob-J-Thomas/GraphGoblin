export type NodeMap = 'outputs' | 'gates' | 'counters.nodeVisits';

export interface TextSpan {
  start: number;
  end: number;
  replacement: (id: string) => string;
}

export interface ReferenceSite {
  map: NodeMap;
  id: string;
  optional: boolean;
  span: TextSpan;
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
