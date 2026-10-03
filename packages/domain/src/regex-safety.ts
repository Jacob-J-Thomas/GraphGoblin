/**
 * A conservative static check for regular expressions that can backtrack catastrophically.
 *
 * JavaScript's regex engine runs synchronously and never yields, so neither the JSONata
 * evaluator's time budget nor any other in-process deadline can stop a pathological match such
 * as `/^(a+)+$/` against `"aaaa…!"` (ADV-007). Patterns are therefore checked before they run,
 * and rejected when they contain one of the constructs behind exponential backtracking:
 *
 * - a back-reference (`\1`, `\k<name>`), which makes matching NP-hard in general;
 * - a repeated group that itself contains a repetition (`(a+)+`, `(\w*\s?)*`, `((ab)*c){2,}`);
 * - a repeated group with alternatives that can start with the same character (`(a|aa)*`,
 *   `(\d|1)+`), where the engine can split the same input in exponentially many ways.
 *
 * The check is deliberately syntactic and errs on the side of rejecting. It does not bound
 * polynomial backtracking (`.*.*.*x` on a very large string); see docs/05 and docs/11 for that
 * residual risk.
 */

type Quantifier = { min: number; max: number };

type Atom =
  | { kind: 'char'; char: string }
  | { kind: 'any' }
  | { kind: 'group'; alternatives: Item[][] }
  | { kind: 'assertion' };

interface Item {
  atom: Atom;
  quantifier?: Quantifier;
}

class UnsafeRegex extends Error {}

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Item[][] {
    const alternatives = this.alternatives();
    if (this.index < this.source.length) throw new UnsafeRegex('unbalanced ")"');
    return alternatives;
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }

  private alternatives(): Item[][] {
    const alternatives: Item[][] = [this.sequence()];
    while (this.peek() === '|') {
      this.index += 1;
      alternatives.push(this.sequence());
    }
    return alternatives;
  }

  private sequence(): Item[] {
    const items: Item[] = [];
    for (let c = this.peek(); c !== undefined && c !== '|' && c !== ')'; c = this.peek()) {
      const atom = this.atom();
      const quantifier = this.quantifier();
      items.push(quantifier ? { atom, quantifier } : { atom });
    }
    return items;
  }

  private atom(): Atom {
    const c = this.source[this.index] as string;
    this.index += 1;
    switch (c) {
      case '(':
        return this.group();
      case '[':
        this.skipClass();
        return { kind: 'any' };
      case '.':
        return { kind: 'any' };
      case '^':
      case '$':
        return { kind: 'assertion' };
      case '\\':
        return this.escape();
      default:
        return { kind: 'char', char: c };
    }
  }

  /** Groups of every flavour; a lookaround's body is checked like any other group's. */
  private group(): Atom {
    if (this.peek() === '?') {
      const rest = this.source.slice(this.index + 1);
      if (rest.startsWith('<') && !rest.startsWith('<=') && !rest.startsWith('<!')) {
        const end = this.source.indexOf('>', this.index);
        this.index = end < 0 ? this.source.length : end + 1;
      } else {
        this.index += rest.startsWith('<') ? 3 : 2;
      }
    }
    const alternatives = this.alternatives();
    if (this.peek() !== ')') throw new UnsafeRegex('unbalanced "("');
    this.index += 1;
    return { kind: 'group', alternatives };
  }

  /** A character class; in JavaScript `[]` is an empty class and `[^]` matches anything. */
  private skipClass(): void {
    if (this.peek() === '^') this.index += 1;
    while (this.index < this.source.length && this.peek() !== ']') {
      this.index += this.peek() === '\\' ? 2 : 1;
    }
    this.index += 1;
  }

  private escape(): Atom {
    const c = this.source[this.index];
    this.index += 1;
    if (c === undefined) return { kind: 'char', char: '\\' };
    if (/[1-9]/.test(c)) throw new UnsafeRegex(`back-reference \\${c}`);
    if (c === 'k' && this.peek() === '<') throw new UnsafeRegex('named back-reference \\k<…>');
    if ('bB'.includes(c)) return { kind: 'assertion' };
    if ('dDwWsSpP'.includes(c)) {
      if ('pP'.includes(c) && this.peek() === '{') this.skipBraces();
      return { kind: 'any' };
    }
    if (c === 'u' && this.peek() === '{') {
      this.skipBraces();
      return { kind: 'any' };
    }
    if (c === 'x') {
      this.index += 2;
      return { kind: 'any' };
    }
    if (c === 'u') {
      this.index += 4;
      return { kind: 'any' };
    }
    if (c === 'c') {
      this.index += 1;
      return { kind: 'any' };
    }
    return { kind: 'char', char: c };
  }

  private skipBraces(): void {
    const end = this.source.indexOf('}', this.index);
    this.index = end < 0 ? this.source.length : end + 1;
  }

  private quantifier(): Quantifier | undefined {
    const c = this.peek();
    let quantifier: Quantifier | undefined;
    if (c === '*') quantifier = { min: 0, max: Infinity };
    else if (c === '+') quantifier = { min: 1, max: Infinity };
    else if (c === '?') quantifier = { min: 0, max: 1 };
    else if (c === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(this.source.slice(this.index));
      if (!match) return undefined;
      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] ? Number(match[3]) : Infinity;
      this.index += match[0].length - 1;
      quantifier = { min, max };
    }
    if (!quantifier) return undefined;
    this.index += 1;
    if (this.peek() === '?') this.index += 1; // lazy
    return quantifier;
  }
}

function repeats(quantifier: Quantifier | undefined): boolean {
  return quantifier !== undefined && quantifier.max > 1;
}

function containsRepetition(alternatives: Item[][]): boolean {
  return alternatives.some((items) =>
    items.some(
      (item) =>
        repeats(item.quantifier) ||
        (item.atom.kind === 'group' && containsRepetition(item.atom.alternatives)),
    ),
  );
}

/** The character an alternative must start with, or undefined when it could start with many. */
function firstChar(items: Item[], ignoreCase: boolean): string | undefined {
  for (const item of items) {
    if (item.atom.kind === 'assertion') continue;
    if (item.atom.kind !== 'char' || (item.quantifier && item.quantifier.min === 0))
      return undefined;
    return ignoreCase ? item.atom.char.toLowerCase() : item.atom.char;
  }
  return undefined;
}

function overlappingAlternatives(alternatives: Item[][], ignoreCase: boolean): boolean {
  if (alternatives.length < 2) return false;
  const seen = new Set<string>();
  for (const items of alternatives) {
    const first = firstChar(items, ignoreCase);
    if (first === undefined || seen.has(first)) return true;
    seen.add(first);
  }
  return false;
}

function check(alternatives: Item[][], ignoreCase: boolean): void {
  for (const items of alternatives) {
    for (const { atom, quantifier } of items) {
      if (atom.kind !== 'group') continue;
      if (repeats(quantifier)) {
        if (containsRepetition(atom.alternatives)) {
          throw new UnsafeRegex('a repeated group contains another repetition');
        }
        if (overlappingAlternatives(atom.alternatives, ignoreCase)) {
          throw new UnsafeRegex('a repeated group has alternatives that can match the same text');
        }
      }
      check(atom.alternatives, ignoreCase);
    }
  }
}

/**
 * Why a regular expression is unsafe to run on untrusted input, or undefined when the static
 * check finds nothing. Call it on a pattern the RegExp constructor has already accepted.
 */
export function unsafeRegexReason(source: string, flags = ''): string | undefined {
  try {
    check(new Parser(source).parse(), flags.includes('i'));
    return undefined;
  } catch (error) {
    return (error as UnsafeRegex).message;
  }
}
