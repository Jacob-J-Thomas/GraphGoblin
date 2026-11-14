import { expressionReferences } from './expression-references.js';
import { expressionAst } from './expression.js';
import type { ReferenceScope, ReferenceSite } from './node-reference-path.js';
import { templateReferences } from './template-references.js';
import { parseAuthoredTemplate } from './template.js';

export type SourceKind = 'template' | 'expression';

interface SourceAnalysis {
  readonly problem: string | null;
  readonly sites: readonly ReferenceSite[];
  readonly uncertain: boolean;
}

const ENTRY_LIMIT = 1024;
const SIZE_LIMIT = 1024 * 1024;
const ENTRY_SIZE_LIMIT = 16 * 1024;
const cache = new Map<string, { facts: SourceAnalysis; size: number }>();
let retainedSize = 0;

function analyze(kind: SourceKind, source: string, scope?: ReferenceScope): SourceAnalysis {
  const empty = { sites: [], uncertain: false };
  if (kind === 'expression' && source.trim() === '') {
    return {
      ...empty,
      uncertain: true,
      problem: 'expression is required; a blank expression is not valid',
    };
  }

  try {
    if (kind === 'template') {
      const parsed = parseAuthoredTemplate(source);
      // All supported Liquid references use the thread root. Callers decide whether the
      // field actually receives that root before using these template facts.
      return { ...(scope ? templateReferences(source, parsed) : empty), problem: null };
    }
    const ast = expressionAst(source);
    return { ...(scope ? expressionReferences(source, scope, ast) : empty), problem: null };
  } catch (error) {
    return {
      ...empty,
      uncertain: true,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Share immutable, source-only facts. The budget accounts for retained source/message text
 * and allows for each reference record. Oversized
 * results bypass the cache without displacing other loops' authored sources.
 */
export function sourceAnalysis(
  kind: SourceKind,
  source: string,
  scope?: ReferenceScope,
): SourceAnalysis {
  const prefix = kind + ':' + (scope ?? 'syntax');
  // Avoid holding large input keys or parser output after this call.
  if (source.length * 2 > ENTRY_SIZE_LIMIT) return analyze(kind, source, scope);
  const key = prefix + ':' + source;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.facts;
  }
  const facts = analyze(kind, source, scope);
  const size =
    128 +
    2 * (key.length + (facts.problem?.length ?? 0)) +
    facts.sites.reduce((total, site) => total + 160 + 2 * site.id.length, 0);
  if (size > ENTRY_SIZE_LIMIT) return facts;
  while (cache.size >= ENTRY_LIMIT || retainedSize + size > SIZE_LIMIT) {
    const oldest = cache.entries().next().value;
    if (!oldest) break;
    cache.delete(oldest[0]);
    retainedSize -= oldest[1].size;
  }
  for (const site of facts.sites) {
    Object.freeze(site.span);
    Object.freeze(site);
  }
  Object.freeze(facts.sites);
  Object.freeze(facts);
  cache.set(key, { facts, size });
  retainedSize += size;
  return facts;
}
