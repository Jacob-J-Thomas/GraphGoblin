import { SlugSchema } from '@graphgoblin/contracts';
import {
  nodeMap,
  referenceSpelling,
  threadOffset,
  type MapAccess,
  type ReferenceScope,
  type SourceReferences,
  type TextSpan,
} from './node-reference-path.js';

interface Ast {
  type: string;
  value?: unknown;
  position?: unknown;
  steps?: unknown;
  stages?: unknown;
  focus?: unknown;
  index?: unknown;
  tuple?: unknown;
  predicate?: unknown;
  group?: unknown;
  keepArray?: unknown;
  arguments?: unknown;
  procedure?: unknown;
  lhs?: unknown;
  rhs?: unknown;
  [key: string]: unknown;
}

function isAst(value: unknown): value is Ast {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

function astList(value: unknown): Ast[] {
  return Array.isArray(value) ? value.filter(isAst) : [];
}

function isVariable(node: unknown, name: string): boolean {
  return isAst(node) && node.type === 'variable' && node.value === name;
}

function stepChangesFocus(step: Ast): boolean {
  return (
    step.stages !== undefined ||
    step.predicate !== undefined ||
    step.focus !== undefined ||
    step.index !== undefined ||
    step.tuple !== undefined ||
    step.group !== undefined ||
    step.keepArray === true
  );
}

/** Check the parsed leaf's exact source before accepting its parser-provided end offset. */
function keySpan(source: string, node: Ast, id: string): TextSpan | undefined {
  const end = node.position;
  if (typeof end !== 'number' || end < 1 || end > source.length) return undefined;
  const quote = source[end - 1];
  if (quote === '"' || quote === "'" || quote === '\x60') {
    // An authored ID is an ASCII slug. In a string token any escape that can decode to
    // one of its characters must be a Unicode escape. Backtick names do not decode escapes.
    const token =
      quote === '\x60'
        ? '\x60' + id + '\x60'
        : new RegExp(quote + '(?:[A-Za-z0-9_-]|\\\\u[0-9a-fA-F]{4}){1,64}' + quote + '$').exec(
            source.slice(Math.max(0, end - 386), end),
          )?.[0];
    if (!token || source.slice(end - token.length, end) !== token) return undefined;
    const decoded =
      quote === '\x60'
        ? token.slice(1, -1)
        : token
            .slice(1, -1)
            .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            );
    if (decoded !== id) return undefined;
    return { start: end - token.length, end, spelling: referenceSpelling(quote) };
  }
  if (node.type !== 'name' || source.slice(end - id.length, end) !== id) return undefined;
  return { start: end - id.length, end, spelling: 'jsonata-name' };
}

/** Collect only bindings that can hide a runtime-supplied root or a builtin we understand. */
function authoredBindings(value: unknown, names: Set<unknown>): void {
  if (Array.isArray(value)) {
    for (const child of value) authoredBindings(child, names);
  } else if (typeof value === 'object' && value !== null) {
    if (isAst(value)) {
      if (value.type === 'bind' && isAst(value.lhs)) names.add(value.lhs.value);
      if (value.type === 'lambda') {
        for (const arg of astList(value.arguments)) names.add(arg.value);
      }
      if (value.focus !== undefined) names.add(value.focus);
      if (typeof value.index === 'string') names.add(value.index);
    }
    for (const child of Object.values(value)) authoredBindings(child, names);
  }
}

export function expressionReferences(
  source: string,
  scope: ReferenceScope,
  ast: unknown,
): SourceReferences {
  const result: SourceReferences = { sites: [], uncertain: false };
  const bindings = new Set<unknown>();

  function scopedPath(steps: Ast[], localFocus: boolean) {
    const root = steps[0];
    const names = steps.map((step) => (step.type === 'name' ? step.value : undefined));
    if (!root) return undefined;
    if (isVariable(root, 'thread') && scope === 'binding')
      return { names, offset: 1, shadowed: bindings.has('thread') };
    if (isVariable(root, '$') || (localFocus && isVariable(root, ''))) {
      const offset = threadOffset(names.slice(1), scope);
      if (offset !== undefined)
        return { names, offset: offset + 1, shadowed: isVariable(root, '$') && bindings.has('$') };
    } else if (localFocus) {
      const offset = threadOffset(names, scope);
      if (offset !== undefined) return { names, offset, shadowed: false };
    }
    return undefined;
  }

  function access(steps: Ast[], localFocus: boolean): MapAccess | undefined {
    const path = scopedPath(steps, localFocus);
    if (!path) return undefined;
    const map = nodeMap(path.names, path.offset);
    if (map && (path.shadowed || steps.slice(0, map.keyIndex).some(stepChangesFocus))) {
      result.uncertain = true;
      return undefined;
    }
    return map;
  }

  function add(map: MapAccess, token: Ast | undefined, optional: boolean): void {
    const parsed = SlugSchema.safeParse(token?.value);
    const span = token && parsed.success ? keySpan(source, token, parsed.data) : undefined;
    if (span && parsed.success) {
      result.sites.push({ map: map.map, id: parsed.data, optional, span });
    } else {
      result.uncertain = true;
    }
  }

  function visit(value: unknown, localFocus: boolean, optional = false, applied = false): void {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, localFocus);
      return;
    }
    if (!isAst(value)) return;
    visitValue(value, localFocus, optional && !stepChangesFocus(value), applied);

    // These parts run against the selected value or group. Only an explicit original root
    // or a supplied binding can identify the thread from this focus.
    const siteCount = result.sites.length;
    visit(value.stages, false);
    visit(value.predicate, false);
    if (typeof value.group === 'object' && value.group !== null && 'lhs' in value.group)
      visit(value.group.lhs, false);
    // JSONata calls evaluateFunction directly for a function on the RHS of ~>, bypassing
    // its attachments. Report references there as uncertain without inferring a runtime read.
    if (applied && value.type === 'function' && result.sites.length > siteCount) {
      result.sites.length = siteCount;
      result.uncertain = true;
    }
  }

  function visitValue(value: Ast, localFocus: boolean, optional: boolean, applied: boolean): void {
    if (value.type === 'path') {
      const steps = astList(value.steps);
      const map = access(steps, localFocus);
      if (map) {
        const key = steps[map.keyIndex];
        const direct = steps
          .slice(map.keyIndex)
          .every((step) => step.type === 'name' && !stepChangesFocus(step));
        add(map, key?.type === 'name' ? key : undefined, optional && direct);
      }
      const simpleSuffix = steps
        .slice(1)
        .every((step) => step.type === 'name' && !stepChangesFocus(step));
      steps.forEach((step, index) =>
        visit(step, localFocus && index === 0, optional && index === 0 && simpleSuffix),
      );
      return;
    }
    if (value.type === 'block') {
      const expressions = astList(value.expressions);
      for (const expression of expressions)
        visit(expression, localFocus, optional && expressions.length === 1);
      return;
    }
    if (value.type === 'apply') {
      const right = value.rhs;
      const exists =
        isAst(right) &&
        right.type === 'function' &&
        isVariable(right.procedure, 'exists') &&
        !bindings.has('exists') &&
        Array.isArray(right.arguments) &&
        right.arguments.length === 0;
      visit(value.lhs, localFocus, exists);
      visit(right, localFocus, false, true);
      return;
    }
    if (value.type === 'function') {
      const args = astList(value.arguments);
      if (isVariable(value.procedure, 'eval') && !bindings.has('eval')) result.uncertain = true;
      if (
        !applied &&
        isVariable(value.procedure, 'lookup') &&
        !bindings.has('lookup') &&
        args.length === 2
      ) {
        const steps = astList(args[0]?.steps);
        const map = access(steps, localFocus);
        if (map && map.keyIndex === steps.length && !args[0]?.group && !args[0]?.predicate) {
          const key = args[1];
          if (key?.type === 'string' && !stepChangesFocus(key)) {
            add(map, key, optional);
          } else {
            result.uncertain = true;
            // The key is evaluated even when the lookup result is only probed for presence.
            visit(key, localFocus);
          }
          return;
        }
      }
      const exists =
        !applied &&
        isVariable(value.procedure, 'exists') &&
        !bindings.has('exists') &&
        args.length === 1;
      for (const arg of args) visit(arg, localFocus, exists);
      visit(value.procedure, localFocus);
      return;
    }
    if (value.type === 'transform') {
      // Transform expressions evaluate a copy selected by a caller; inside the
      // pattern/update, only the original explicit root is provable.
      for (const child of [value.pattern, value.update, value.delete]) visit(child, false);
      return;
    }
    if (value.type === 'filter' || value.type === 'sort') {
      if (value.type === 'sort') {
        const terms: unknown[] = Array.isArray(value.terms) ? value.terms : [];
        for (const term of terms) {
          if (typeof term === 'object' && term !== null && 'expression' in term)
            visit(term.expression, false);
        }
      } else {
        visit(value.expr, false);
      }
      return;
    }
    if (value.type === 'binary' && (value.value === '=' || value.value === '!=')) {
      const potentialIdentity = (candidate: unknown): boolean => {
        if (!isAst(candidate) || candidate.type !== 'path') return false;
        const steps = astList(candidate.steps);
        const path = scopedPath(steps, localFocus);
        if (!path || path.shadowed || steps.some(stepChangesFocus)) return false;
        const names = path.names.slice(path.offset);
        return (
          (names.length === 2 && names[0] === 'trigger' && names[1] === 'nodeId') ||
          (names.length === 3 &&
            names[0] === 'invocation' &&
            names[2] === 'nodeId' &&
            (names[1] === 'trigger' || names[1] === 'replayOf'))
        );
      };
      if (potentialIdentity(value.lhs) || potentialIdentity(value.rhs)) result.uncertain = true;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'stages' && key !== 'predicate' && key !== 'group') visit(child, localFocus);
    }
  }

  try {
    authoredBindings(ast, bindings);
    visit(ast, true);
  } catch {
    return { sites: [], uncertain: true };
  }
  return result;
}
