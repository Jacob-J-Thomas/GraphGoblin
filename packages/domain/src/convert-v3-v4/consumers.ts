import jsonata from 'jsonata';
import { Liquid, TokenKind } from 'liquidjs';
import type { V3DecisionConfig } from '@graphgoblin/contracts';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Conservative metadata analysis: aliases, root access and computed paths need review. */
export function consumerNeedsReview(
  source: string,
  kind: 'expression' | 'template',
  safeOutputs = new Set<string>(),
  safeLastOutput = false,
): boolean {
  const unsafePath = (path: string[]) => {
    if (path[0] === 'outputs') return !(safeOutputs.has(path[1] ?? '') && path[2] === 'value');
    if (path[0] === 'lastOutput') return !safeLastOutput;
    return ['vars', 'parent', 'thread', 'context', 'child', 'result'].includes(path[0] ?? '');
  };
  const seen = new Set<object>();
  const inspect = (node: unknown, procedure = false): boolean => {
    if (Array.isArray(node)) return node.some((entry) => inspect(entry));
    if (!object(node) || seen.has(node)) return false;
    seen.add(node);
    if (kind === 'expression') {
      if (['string', 'number', 'value'].includes(String(node.type))) return false;
      if (node.type === 'variable')
        return (
          !procedure ||
          ['eval', 'lookup', 'keys', 'each', 'spread', 'sift', 'merge', 'map', 'reduce'].includes(
            String(node.value),
          )
        );
      if (['wildcard', 'descendant', 'parent', 'transform', 'lambda'].includes(String(node.type)))
        return true;
      if (node.type === 'path' && Array.isArray(node.steps)) {
        if (
          node.steps.some(
            (step) =>
              !object(step) ||
              step.type !== 'name' ||
              step.stages !== undefined ||
              step.predicate !== undefined,
          )
        )
          return true;
        return unsafePath(node.steps.map((step) => String((step as Obj).value)));
      }
      if (node.type === 'name') return unsafePath([String(node.value)]);
      if (node.type === 'function') return inspect(node.procedure, true) || inspect(node.arguments);
    } else {
      if (node.kind === TokenKind.PropertyAccess && Array.isArray(node.props)) {
        if (
          node.props.some(
            (prop) =>
              !object(prop) || ![TokenKind.Word, TokenKind.Quoted].includes(Number(prop.kind)),
          )
        )
          return true;
        return unsafePath(node.props.map((prop) => String((prop as Obj).content)));
      }
      if (node.kind === TokenKind.HTML || node.kind === TokenKind.Quoted) return false;
    }
    return Object.entries(node).some(
      ([key, value]) =>
        !(
          kind === 'expression'
            ? ['type', 'value', 'position']
            : ['liquid', 'engine', 'tokenizer', 'input']
        ).includes(key) && inspect(value),
    );
  };
  return inspect(kind === 'expression' ? jsonata(source).ast() : new Liquid().parse(source));
}

/** Rewrite only unfiltered lexical root names proven by JSONata's AST, never string literals. */
export function rewriteLastOutput(source: string, replacement: string): string | null {
  const edits: { start: number; end: number }[] = [];
  let unsafe = false;
  const walk = (node: unknown, procedure = false): void => {
    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry));
      return;
    }
    if (!object(node)) return;
    if (node.type === 'path' && Array.isArray(node.steps)) {
      if (
        node.steps.some(
          (step) =>
            !object(step) ||
            step.type !== 'name' ||
            step.stages !== undefined ||
            step.predicate !== undefined,
        )
      )
        unsafe = true;
      const [first, ...rest] = node.steps as unknown[];
      walk(first);
      // Only a root name means the thread's lastOutput. Nested object keys are unrelated.
      for (const step of rest) if (!object(step) || step.type !== 'name') walk(step);
      return;
    }
    if (node.type === 'variable' && !procedure) unsafe = true;
    if (['wildcard', 'descendant', 'parent', 'transform', 'lambda'].includes(String(node.type)))
      unsafe = true;
    if (node.type === 'name' && node.value === 'lastOutput') {
      const end = Number(node.position);
      if (source.slice(end - 'lastOutput'.length, end) !== 'lastOutput') unsafe = true;
      edits.push({ start: end - 'lastOutput'.length, end });
    }
    if (
      node.type === 'function' &&
      object(node.procedure) &&
      ['eval', 'lookup'].includes(String(node.procedure.value))
    )
      unsafe = true;
    for (const [key, value] of Object.entries(node))
      if (!['type', 'value', 'position'].includes(key)) walk(value, key === 'procedure');
  };
  walk(jsonata(source).ast());
  if (unsafe) return null;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + replacement + source.slice(edit.end);
  return source;
}

/** Proposals use parser token offsets. Literal text and unproven aliases are never rewritten. */
export function proposeAnswerConsumer(
  source: string,
  kind: 'expression' | 'template',
  decisions: ReadonlyMap<string, V3DecisionConfig>,
  lastProducer: string | null,
): string {
  const edits: { start: number; end: number; value: string }[] = [];
  const seen = new Set<object>();
  const inspect = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(inspect);
      return;
    }
    if (!object(node) || seen.has(node)) return;
    seen.add(node);
    const tokens =
      kind === 'expression' && node.type === 'path' && Array.isArray(node.steps)
        ? node.steps
        : kind === 'template' && node.kind === TokenKind.PropertyAccess && Array.isArray(node.props)
          ? node.props
          : null;
    if (tokens) {
      const staticTokens = tokens.every(
        (token) =>
          object(token) &&
          (kind === 'expression'
            ? token.type === 'name' && token.stages === undefined && token.predicate === undefined
            : [TokenKind.Word, TokenKind.Quoted].includes(Number(token.kind))),
      );
      if (!staticTokens) return;
      const parts = tokens.map((token) =>
        String((token as Obj)[kind === 'expression' ? 'value' : 'content']),
      );
      const offset = parts[0] === 'outputs' ? 3 : parts[0] === 'lastOutput' ? 2 : -1;
      const config = decisions.get(parts[0] === 'outputs' ? parts[1]! : (lastProducer ?? ''));
      if (!config || offset < 0 || parts[offset - 1] !== 'value' || parts[offset] !== 'answer')
        return;
      const answer = tokens[offset] as Obj;
      const start = kind === 'expression' ? Number(answer.position) - 6 : Number(answer.begin);
      const end = (token: unknown) =>
        Number((token as Obj)[kind === 'expression' ? 'position' : 'end']);
      if (source.slice(start, end(answer)) !== 'answer') return;
      if (config.evaluation.kind === 'classifier') {
        if (parts[offset + 1] !== 'kind') edits.push({ start, end: start, value: 'observation.' });
      } else if (parts[offset + 1] === 'optionId' || parts[offset + 1] === 'confidence') {
        edits.push({
          start,
          end: end(tokens[offset + 1]),
          value: 'observation.' + (parts[offset + 1] === 'optionId' ? 'routeId' : 'confidence'),
        });
      } else if (
        kind === 'expression' &&
        config.answer.type === 'noul' &&
        parts[offset + 1] === 'holds' &&
        parts.length === offset + 2
      ) {
        const first = tokens[0] as Obj;
        const rootStart = Number(first.position) - parts[0]!.length;
        edits.push({
          start: rootStart,
          end: end(tokens[offset + 1]),
          value:
            '(' +
            source.slice(rootStart, start) +
            'observation.routeId = ' +
            JSON.stringify(config.answer.true.id) +
            ')',
        });
      }
      return;
    }
    if (kind === 'expression' && ['string', 'number', 'value'].includes(String(node.type))) return;
    if (kind === 'template' && [TokenKind.HTML, TokenKind.Quoted].includes(Number(node.kind)))
      return;
    for (const [key, value] of Object.entries(node))
      if (!['liquid', 'engine', 'tokenizer', 'input'].includes(key)) inspect(value);
  };
  inspect(kind === 'expression' ? jsonata(source).ast() : new Liquid().parse(source));
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
