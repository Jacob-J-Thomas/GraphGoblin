import {
  LoopDefinitionSchema,
  LoopExportSchema,
  NoulSpecSchema,
  type LoopDefinition,
  type LoopExport,
  type NoulSpec,
} from '@graphgoblin/contracts';
import jsonata from 'jsonata';
import { syntaxIssues } from './syntax.js';
import {
  upgradeLoopV1,
  validateUpgradeResolutions,
  type UpgradeResolutions,
  type UpgradeResult,
  type UpgradeIssue,
} from './upgrade.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const issue = (code: string, path: string, message: string): UpgradeIssue => ({
  code,
  path,
  message,
});
export interface ExitPredicateResolution {
  answer?: NoulSpec;
  jsonata?: string;
}
/** Exact source pointers are protected by the enclosing version's definition hash. */
export interface UpgradeCurrentResolutions extends UpgradeResolutions {
  predicates?: Record<string, ExitPredicateResolution>;
}
export function validateUpgradeCurrentResolutions(value: unknown): UpgradeIssue[] {
  if (!object(value)) return [issue('UPGRADE_RESOLUTION_INVALID', '/', 'expected resolution maps')];
  const { predicates, ...v1 } = value;
  const invalid = validateUpgradeResolutions(v1);
  if (invalid.length) return invalid;
  if (predicates === undefined) return [];
  if (
    !object(predicates) ||
    Object.entries(predicates).some(
      ([path, entry]) =>
        !/^\/nodes\/\d+\/config\/criteria\/\d+$/.test(path) ||
        !object(entry) ||
        !Object.keys(entry).length ||
        Object.keys(entry).some((key) => !['answer', 'jsonata'].includes(key)) ||
        (entry.answer !== undefined && !NoulSpecSchema.safeParse(entry.answer).success) ||
        (entry.jsonata !== undefined &&
          (typeof entry.jsonata !== 'string' || !entry.jsonata.trim())),
    )
  )
    return [
      issue(
        'UPGRADE_RESOLUTION_INVALID',
        '/predicates',
        'expected exact predicate pointers with authored Noul sides or a boolean expression rewrite',
      ),
    ];
  return [];
}

/** Only results that are syntactically guaranteed booleans avoid an explicit owner rewrite. */
export function provenBooleanExpression(source: string): boolean {
  try {
    const booleanNodeFields: Record<string, readonly string[]> = {
      value: ['type', 'value', 'position'],
      binary: ['type', 'value', 'position', 'lhs', 'rhs'],
      condition: ['type', 'position', 'condition', 'then', 'else'],
      block: ['type', 'position', 'expressions'],
    };
    const prove = (node: unknown): boolean => {
      if (!object(node)) return false;
      const fields = typeof node.type === 'string' ? booleanNodeFields[node.type] : undefined;
      // Filters, grouping and array/sequence modifiers can change even a boolean node's result.
      if (!fields || Object.keys(node).some((key) => !fields.includes(key))) return false;
      if (node.type === 'value') return typeof node.value === 'boolean';
      if (node.type === 'binary')
        // Relational comparisons can return undefined when either operand is missing.
        return ['=', '!=', 'in', 'and', 'or'].includes(String(node.value));
      if (node.type === 'condition') return prove(node.then) && prove(node.else);
      if (node.type === 'block' && Array.isArray(node.expressions))
        return prove(node.expressions.at(-1));
      return false;
    };
    return prove(jsonata(source).ast());
  } catch {
    return false;
  }
}

/** Composes the retained frozen v1 -> v2 stage with the single current exit cutover. */
export function upgradeLoopCurrent(
  input: unknown,
  resolutions: UpgradeCurrentResolutions = {},
): UpgradeResult<LoopDefinition> {
  const errors = validateUpgradeCurrentResolutions(resolutions);
  if (errors.length) return { ok: false, issues: errors };
  const { predicates = {}, ...v1 } = resolutions;
  if (object(input) && input.schemaVersion === 3) {
    if (
      [
        resolutions.decisions,
        resolutions.sources,
        resolutions.opaqueConsumers,
        resolutions.predicates,
      ].some((value) => value !== undefined && Object.keys(value).length > 0)
    )
      return {
        ok: false,
        issues: [
          issue(
            'UPGRADE_RESOLUTION_INVALID',
            '/',
            'current definitions require no legacy resolutions',
          ),
        ],
      };
    const parsed = LoopDefinitionSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        issues: [issue('UPGRADE_V3_INVALID', '/', 'current definition violates format 3')],
      };
    const syntax = syntaxIssues(parsed.data);
    return syntax.length
      ? {
          ok: false,
          issues: syntax.map((error) => issue('UPGRADE_SOURCE_INVALID', error.path, error.message)),
        }
      : { ok: true, value: parsed.data, notices: [] };
  }
  const frozen = upgradeLoopV1(input, v1);
  if (!frozen.ok) return frozen;
  const value = JSON.parse(JSON.stringify(frozen.value)) as Obj;
  const issues: UpgradeIssue[] = [],
    notices = [...frozen.notices];
  const used = new Set<string>();
  (value.nodes as Obj[]).forEach((node, nodeIndex) => {
    if (node.kind !== 'exit') return;
    const config = node.config as Obj;
    (config.criteria as Obj[]).forEach((criterion, criterionIndex) => {
      if (criterion.when !== 'predicate') return;
      const path = `/nodes/${nodeIndex}/config/criteria/${criterionIndex}`;
      const resolution = predicates[path];
      if (resolution) used.add(path);
      let answer: unknown, evaluation: unknown;
      const match: Obj = { type: 'noul', value: true };
      if (criterion.strategy === 'expression') {
        const source = resolution?.jsonata ?? criterion.jsonata;
        if (resolution?.answer || typeof source !== 'string' || !provenBooleanExpression(source)) {
          issues.push(
            issue(
              'UPGRADE_EXIT_BOOLEAN_REQUIRED',
              path + '/jsonata',
              'approve an explicit expression whose result is provably boolean; coercing the old value is not automatic',
            ),
          );
          return;
        }
        answer = { type: 'noul' };
        evaluation = { kind: 'expression', jsonata: source };
        if (resolution)
          notices.push(issue('UPGRADE_OWNER_EXIT', path, 'approved boolean expression rewrite'));
      } else {
        if (!resolution?.answer || resolution.jsonata !== undefined) {
          issues.push(
            issue(
              'UPGRADE_EXIT_CRITERIA_REQUIRED',
              path,
              'supply explicit nonblank true and false Noul criteria for this provider predicate',
            ),
          );
          return;
        }
        answer = resolution.answer;
        if (criterion.strategy === 'jev')
          evaluation = {
            kind: 'classifier',
            model: 'jev',
            question: criterion.question,
            truthThreshold: 0.5,
            ...(criterion.minConfidence !== undefined
              ? { minConfidence: criterion.minConfidence }
              : {}),
          };
        else {
          evaluation = {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: criterion.question,
          };
          if (criterion.minConfidence !== undefined)
            match.minReportedConfidence = criterion.minConfidence;
        }
        notices.push(
          issue(
            'UPGRADE_OWNER_EXIT',
            path,
            'approved explicit provider Noul criteria; native judgments can change',
          ),
        );
      }
      config.criteria = (config.criteria as Obj[]).map((entry, index) =>
        index === criterionIndex
          ? { when: 'predicate', answer, evaluation, match, outcome: criterion.outcome }
          : entry,
      );
    });
  });
  for (const path of Object.keys(predicates))
    if (!used.has(path))
      issues.push(
        issue('UPGRADE_RESOLUTION_INVALID', path, 'resolution does not name a legacy predicate'),
      );
  if (issues.length) return { ok: false, issues };
  value.schemaVersion = 3;
  const parsed = LoopDefinitionSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((error) =>
        issue('UPGRADE_V3_INVALID', '/' + error.path.map(String).join('/'), error.message),
      ),
    };
  const syntax = syntaxIssues(parsed.data);
  if (syntax.length)
    return {
      ok: false,
      issues: syntax.map((error) => issue('UPGRADE_SOURCE_INVALID', error.path, error.message)),
    };
  return { ok: true, value: parsed.data, notices };
}

export function upgradeExportCurrent(
  input: unknown,
  resolutions: UpgradeCurrentResolutions = {},
): UpgradeResult<LoopExport> {
  if (
    !object(input) ||
    Object.keys(input).some(
      (key) => !['format', 'formatVersion', 'exportedAt', 'loop'].includes(key),
    ) ||
    input.format !== 'graphgoblin-loop' ||
    ![1, 2, 3].includes(Number(input.formatVersion)) ||
    !object(input.loop) ||
    input.loop.schemaVersion !== input.formatVersion
  )
    return {
      ok: false,
      issues: [
        issue('UPGRADE_EXPORT_INVALID', '/', 'expected a matching exact loop export envelope'),
      ],
    };
  const result = upgradeLoopCurrent(input.loop, resolutions);
  if (!result.ok) return result;
  const parsed = LoopExportSchema.safeParse({ ...input, formatVersion: 3, loop: result.value });
  return parsed.success
    ? { ok: true, value: parsed.data, notices: result.notices }
    : {
        ok: false,
        issues: [issue('UPGRADE_EXPORT_INVALID', '/', 'export timestamp or envelope is invalid')],
      };
}
