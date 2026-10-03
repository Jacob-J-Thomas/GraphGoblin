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
 * - a repeated group whose body can split the same text in more than one way: alternatives that
 *   can start with the same character (`(a|aa)*`, `(\d|1)+`), an optional part that can match
 *   the same text as what follows it (`(?:a?a?)+`, `(?:a?a)+`), or a body that can match the
 *   empty string. Groups nested inside the body without their own repetition are looked through
 *   (`(?:(?:a|aa))+`).
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

/** Stands for "any character" in a first-character set: a class, `.`, or an escape class. */
const ANY = '\u0000any';

/** The characters a piece can start with, and whether it can match the empty string. */
interface First {
  chars: Set<string>;
  nullable: boolean;
}

function atomFirst(atom: Atom, ignoreCase: boolean): First {
  switch (atom.kind) {
    case 'assertion':
      return { chars: new Set(), nullable: true };
    case 'any':
      return { chars: new Set([ANY]), nullable: false };
    case 'char':
      return {
        chars: new Set([ignoreCase ? atom.char.toLowerCase() : atom.char]),
        nullable: false,
      };
    case 'group':
      return alternativesFirst(atom.alternatives, ignoreCase);
  }
}

function itemFirst(item: Item, ignoreCase: boolean): First {
  const first = atomFirst(item.atom, ignoreCase);
  return { chars: first.chars, nullable: first.nullable || item.quantifier?.min === 0 };
}

function sequenceFirst(items: Item[], ignoreCase: boolean, from = 0): First {
  const chars = new Set<string>();
  for (let i = from; i < items.length; i += 1) {
    const first = itemFirst(items[i] as Item, ignoreCase);
    for (const c of first.chars) chars.add(c);
    if (!first.nullable) return { chars, nullable: false };
  }
  return { chars, nullable: true };
}

function alternativesFirst(alternatives: Item[][], ignoreCase: boolean): First {
  const chars = new Set<string>();
  let nullable = false;
  for (const items of alternatives) {
    const first = sequenceFirst(items, ignoreCase);
    for (const c of first.chars) chars.add(c);
    nullable ||= first.nullable;
  }
  return { chars, nullable };
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  if (a.has(ANY) || b.has(ANY)) return true;
  for (const c of a) if (b.has(c)) return true;
  return false;
}

/**
 * Whether the body of a repeated group can split the same text in more than one way, looking
 * through groups that are not themselves repeated. `follow` is what can start right after the
 * part being checked (inside a repetition, that includes the body's own start).
 */
function ambiguity(
  alternatives: Item[][],
  follow: Set<string>,
  ignoreCase: boolean,
): string | undefined {
  if (alternatives.length > 1) {
    const seen = new Set<string>();
    for (const items of alternatives) {
      const first = sequenceFirst(items, ignoreCase);
      if (first.nullable || overlaps(first.chars, seen)) {
        return 'a repeated group has alternatives that can match the same text';
      }
      for (const c of first.chars) seen.add(c);
    }
  }
  for (const items of alternatives) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] as Item;
      const rest = sequenceFirst(items, ignoreCase, i + 1);
      const next = rest.nullable ? new Set([...rest.chars, ...follow]) : rest.chars;
      const first = itemFirst(item, ignoreCase);
      if (first.nullable && overlaps(first.chars, next)) {
        return 'a repeated group has an optional part that can match the same text as what follows it';
      }
      if (item.atom.kind === 'group') {
        const nested = ambiguity(item.atom.alternatives, next, ignoreCase);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

function check(alternatives: Item[][], ignoreCase: boolean): void {
  for (const items of alternatives) {
    for (const { atom, quantifier } of items) {
      if (atom.kind !== 'group') continue;
      if (repeats(quantifier)) {
        if (containsRepetition(atom.alternatives)) {
          throw new UnsafeRegex('a repeated group contains another repetition');
        }
        const body = alternativesFirst(atom.alternatives, ignoreCase);
        if (body.nullable) throw new UnsafeRegex('a repeated group can match the empty string');
        const reason = ambiguity(atom.alternatives, body.chars, ignoreCase);
        if (reason) throw new UnsafeRegex(reason);
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
