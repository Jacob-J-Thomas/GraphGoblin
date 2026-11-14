import { SlugSchema } from '@graphgoblin/contracts';
import {
  IfTag,
  UnlessTag,
  Tokenizer,
  TokenKind,
  evalQuotedToken,
  type PropertyAccessToken,
  type QuotedToken,
  type Template,
} from 'liquidjs';
import type { parseAuthoredTemplate } from './template.js';
import { nodeMap, referenceSpelling, type SourceReferences } from './node-reference-path.js';

/** Only a single property access in an if/elsif/unless condition is a deliberate presence probe. */
function presenceProbes(
  templates: Template[],
  probes: Set<number>,
  potentialShadows: Set<string>,
): void {
  for (const template of templates) {
    // Some tags expose their block scope to analysis even in an else branch
    // where that variable is absent at runtime. Do not rewrite classified locals.
    for (const variable of template.blockScope?.() ?? []) potentialShadows.add(variable);
    if (template instanceof IfTag || template instanceof UnlessTag) {
      for (const { value } of template.branches) {
        const [token] = value.initial.postfix;
        if (
          value.filters.length === 0 &&
          value.initial.postfix.length === 1 &&
          token?.kind === TokenKind.PropertyAccess
        )
          probes.add(token.begin);
      }
    }
    // Use the same no-partials, synchronous child traversal as Liquid's public analyzer.
    const children = template.children?.(false, true).next();
    if (children?.done) presenceProbes(children.value, probes, potentialShadows);
  }
}

export function templateReferences(
  source: string,
  { engine, templates }: ReturnType<typeof parseAuthoredTemplate>,
): SourceReferences {
  const result: SourceReferences = { sites: [], uncertain: false };
  if (!source.includes('{{') && !source.includes('{%')) return result;
  try {
    const {
      globals,
      locals,
      variables: allVariables,
    } = engine.analyzeSync(templates, { partials: false });
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '\n') starts.push(index + 1);
    }
    const probes = new Set<number>();
    const potentialShadows = new Set(Object.keys(locals));
    presenceProbes(templates, probes, potentialShadows);
    result.uncertain = [...potentialShadows].some((root) =>
      (Object.hasOwn(allVariables, root) ? allVariables[root] : [])?.some(
        (value) =>
          nodeMap(value.toArray(), 0) &&
          (!Object.hasOwn(globals, root) || !globals[root]?.includes(value)),
      ),
    );
    for (const [root, variables] of Object.entries(globals)) {
      for (const variable of variables) {
        const path = variable.toArray();
        const map = nodeMap(path, 0);
        if (!map) continue;
        const { row, col } = variable.location;
        const line = starts[row - 1];
        const parsed = SlugSchema.safeParse(path[map.keyIndex]);
        if (line === undefined || !parsed.success) {
          result.uncertain = true;
          continue;
        }
        // An assign/capture inside an alternate, repeated or skipped branch can make
        // analyzer classification imprecise. Avoid changing uses of a redeclared root.
        if (Object.hasOwn(locals, root)) {
          result.uncertain = true;
          continue;
        }
        const start = line + col - 1;
        const tokenizer = new Tokenizer(source, engine.options.operators, undefined, [
          start,
          source.length,
        ]);
        const token = tokenizer.readValue();
        const propertyPath =
          token?.kind === TokenKind.PropertyAccess ? (token as PropertyAccessToken).props : [];
        const staticProperty = (property: (typeof propertyPath)[number] | undefined) => {
          if (property?.kind === TokenKind.Quoted) return evalQuotedToken(property as QuotedToken);
          if (property?.kind === TokenKind.Word) return property.getText();
          return undefined;
        };
        const prefixMatches = path
          .slice(0, map.keyIndex)
          .every((segment, index) => staticProperty(propertyPath[index]) === segment);
        const property = prefixMatches ? propertyPath[map.keyIndex] : undefined;
        const quoted = property?.kind === TokenKind.Quoted;
        const id = staticProperty(property);
        if (!property || id !== parsed.data) {
          result.uncertain = true;
          continue;
        }
        const quote = quoted ? source[property.begin] : undefined;
        result.sites.push({
          id,
          map: map.map,
          optional:
            probes.has(start) &&
            path.every((part) => typeof part === 'string' || typeof part === 'number'),
          span: {
            start: property.begin,
            end: property.end,
            spelling: referenceSpelling(quote),
          },
        });
      }
    }
  } catch {
    return { sites: [], uncertain: true };
  }
  return result;
}
