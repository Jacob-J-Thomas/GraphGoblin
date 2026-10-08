import {
  DecisionConfigSchema,
  HarnessDefaultsSchema,
  JsonValueSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  type DecisionConfig,
  type HarnessDefaults,
  type JsonSchema,
  type LoopDefinition,
  type LoopExport,
} from '@graphgoblin/contracts';
import jsonata from 'jsonata';
import { Liquid, TokenKind } from 'liquidjs';
import { checkExpression } from './expression.js';
import { checkTemplate } from './template.js';
import { validateJson } from './json-schema.js';
import { syntaxIssues } from './syntax.js';
import { LEGACY_V1_SCHEMA } from './upgrade-v1-schema.js';

export interface UpgradeIssue {
  code: string;
  path: string;
  message: string;
}
export type UpgradeResult<T> =
  { ok: true; value: T; notices: UpgradeIssue[] } | { ok: false; issues: UpgradeIssue[] };
/** Explicit owner choices, supplied by an approved offline manifest. Device conversion uses none. */
export interface UpgradeResolutions {
  decisions?: Record<string, DecisionConfig>;
  sources?: Record<string, string>;
  opaqueConsumers?: Record<string, { reason: string }>;
}
/** Runtime defensive validation for owner-authored JSON manifests, shared by the offline store tool. */
export function validateUpgradeResolutions(value: unknown): UpgradeIssue[] {
  const invalid = () => [
    issue(
      'UPGRADE_RESOLUTION_INVALID',
      '/',
      'expected exact decision/source/opaque-consumer resolution maps',
    ),
  ];
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['decisions', 'sources', 'opaqueConsumers'].includes(key))
  )
    return invalid();
  for (const key of ['decisions', 'sources', 'opaqueConsumers'])
    if (value[key] !== undefined && !object(value[key])) return invalid();
  if (
    object(value.decisions) &&
    Object.values(value.decisions).some((config) => !DecisionConfigSchema.safeParse(config).success)
  )
    return invalid();
  if (
    object(value.sources) &&
    Object.values(value.sources).some((source) => typeof source !== 'string')
  )
    return invalid();
  if (
    object(value.opaqueConsumers) &&
    Object.values(value.opaqueConsumers).some(
      (review) =>
        !object(review) ||
        Object.keys(review).some((key) => key !== 'reason') ||
        typeof review.reason !== 'string' ||
        !review.reason.trim(),
    )
  )
    return invalid();
  return [];
}
type Obj = Record<string, unknown>;
function object(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const issue = (code: string, path: string, message: string): UpgradeIssue => ({
  code,
  path,
  message,
});
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Flat v1 defaults were Codex-specific. Never guess the family from a model's spelling. */
export function upgradeDefaultsV1(input: unknown): UpgradeResult<HarnessDefaults> {
  if (!object(input) || Object.keys(input).some((key) => key !== 'model' && key !== 'effort'))
    return {
      ok: false,
      issues: [
        issue('UPGRADE_DEFAULTS_INVALID', '/', 'expected the exact v1 model/effort defaults'),
      ],
    };
  const parsed = HarnessDefaultsSchema.safeParse({
    byHarness: Object.keys(input).length ? { codex: input } : {},
  });
  return parsed.success
    ? { ok: true, value: parsed.data, notices: [] }
    : {
        ok: false,
        issues: [
          issue(
            'UPGRADE_DEFAULTS_INVALID',
            '/',
            'defaults do not satisfy the selected harness contract',
          ),
        ],
      };
}

function provenStringAnswer(source: string, ids: Set<string>): boolean {
  try {
    const prove = (value: unknown): boolean => {
      if (!object(value)) return false;
      if (value.type === 'string') return typeof value.value === 'string' && ids.has(value.value);
      if (value.type === 'condition') return prove(value.then) && prove(value.else);
      if (value.type === 'block' && Array.isArray(value.expressions))
        return prove(value.expressions.at(-1));
      return false;
    };
    return prove(jsonata(source).ast());
  } catch {
    return false;
  }
}

type Source = { kind: 'template' | 'expression'; source: string; path: string };
/** The frozen source markers cover all v1 authored fields, including maps and exit expressions. */
function sourcesIn(schema: unknown, value: unknown, path = '', found: Source[] = []): Source[] {
  if (!object(schema) || value === undefined || value === null) return found;
  const marker = schema['x-upgrade-source'];
  if ((marker === 'template' || marker === 'expression') && typeof value === 'string') {
    found.push({ kind: marker, source: value, path });
    return found;
  }
  const unions = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(unions)) {
    const selected: unknown = unions.find((option) => validateJson(option as JsonSchema, value).ok);
    if (selected) sourcesIn(selected, value, path, found);
  } else if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => sourcesIn(schema.items, item, path + '/' + index, found));
  } else if (object(value)) {
    const properties = object(schema.properties) ? schema.properties : {};
    for (const [key, item] of Object.entries(value))
      sourcesIn(
        properties[key] ?? schema.additionalProperties,
        item,
        path + '/' + escape(key),
        found,
      );
  }
  return found;
}

/** Conservative: only literal access to unchanged output paths can be carried across this cutover. */
function uncertainOutputAccess(
  source: string,
  decisions: Set<string>,
  kind: Source['kind'],
  subloops: Set<string>,
  resultVars: Set<string>,
): boolean {
  if (!decisions.size && !subloops.size) return false;
  const safePath = (steps: string[]): boolean => {
    const root = steps[0];
    if (root === 'lastOutput')
      return (
        ['nodeId', 'at', 'schemaRef'].includes(steps[1] ?? '') ||
        (steps[1] === 'value' &&
          steps.length === 3 &&
          ['status', 'outcome', 'childRunId'].includes(steps[2] ?? ''))
      );
    if (root === 'outputs') {
      const node = steps[1];
      if (!node) return false;
      if (['nodeId', 'at', 'schemaRef'].includes(steps[2] ?? '')) return true;
      if (subloops.has(node))
        return (
          steps[2] === 'value' &&
          steps.length === 4 &&
          ['status', 'outcome', 'childRunId'].includes(steps[3] ?? '')
        );
      return !decisions.has(node) && steps[2] === 'value' && steps.length > 3;
    }
    if (root === 'parent') return steps.length > 1 && safePath(steps.slice(1));
    if (root === 'vars' && resultVars.has(steps[1] ?? '')) return false;
    return (
      !['$', '$$', 'this', 'thread', 'context', 'child', 'result'].includes(root ?? '') &&
      !(root === 'vars' && steps.length === 1)
    );
  };
  if (kind === 'expression') {
    const inspect = (node: unknown, procedure = false): boolean => {
      if (Array.isArray(node)) return node.some((entry: unknown) => inspect(entry));
      if (!object(node)) return false;
      if (node.type === 'string' || node.type === 'number' || node.type === 'value') return false;
      if (node.type === 'variable') {
        if (!procedure) return true; // $, $$ and aliases/closures require owner review.
        return [
          'eval',
          'lookup',
          'keys',
          'each',
          'spread',
          'sift',
          'merge',
          'map',
          'reduce',
        ].includes(String(node.value));
      }
      if (['wildcard', 'descendant', 'parent', 'transform', 'lambda'].includes(String(node.type)))
        return true;
      if (node.type === 'path' && Array.isArray(node.steps)) {
        const steps = node.steps as unknown[];
        if (
          steps.some(
            (step) =>
              !object(step) ||
              step.type !== 'name' ||
              step.stages !== undefined ||
              step.predicate !== undefined,
          )
        )
          return true;
        return !safePath(steps.map((step) => String((step as Obj).value)));
      }
      if (node.type === 'name') return !safePath([String(node.value)]);
      if (node.type === 'function') {
        const args: unknown = node.arguments;
        if (!Array.isArray(args) || !args.length) return true;
        return inspect(node.procedure, true) || args.some((entry: unknown) => inspect(entry));
      }
      return Object.entries(node).some(
        ([key, value]) => !['type', 'value', 'position'].includes(key) && inspect(value),
      );
    };
    return inspect(jsonata(source).ast());
  }
  // Inspect parsed property tokens, not HTML or quoted literal text. Walk nested tags/assignments.
  const inspectLiquid = (node: unknown, seen = new Set<object>()): boolean => {
    if (Array.isArray(node)) return node.some((entry: unknown) => inspectLiquid(entry, seen));
    if (!object(node) || seen.has(node)) return false;
    seen.add(node);
    if (node.kind === TokenKind.PropertyAccess && Array.isArray(node.props)) {
      const props = node.props as unknown[];
      if (
        props.some(
          (prop) =>
            !object(prop) || ![TokenKind.Word, TokenKind.Quoted].includes(Number(prop.kind)),
        )
      )
        return true;
      return !safePath(props.map((prop) => String((prop as Obj).content)));
    }
    if (node.kind === TokenKind.HTML || node.kind === TokenKind.Quoted) return false;
    return Object.entries(node).some(
      ([key, value]) =>
        !['liquid', 'engine', 'tokenizer', 'input'].includes(key) && inspectLiquid(value, seen),
    );
  };
  return inspectLiquid(new Liquid().parse(source));
}

function setSource(root: Obj, pointer: string, value: string): boolean {
  const keys = pointer
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = root;
  for (const key of keys.slice(0, -1)) {
    if (!object(current) && !Array.isArray(current)) return false;
    current = (current as Obj)[key];
  }
  const key = keys.at(-1);
  if (!key || (!object(current) && !Array.isArray(current))) return false;
  (current as Obj)[key] = value;
  return true;
}

function convertDecision(
  config: Obj,
  path: string,
  chosen?: DecisionConfig,
): UpgradeResult<DecisionConfig> {
  if (chosen !== undefined) {
    const parsed = DecisionConfigSchema.safeParse(chosen);
    const oldIds = (config.routes as Obj[]).map((route) => String(route.label)).sort();
    if (
      parsed.success &&
      JSON.stringify(parsed.data.answer.options.map((option) => option.id).sort()) !==
        JSON.stringify(oldIds)
    )
      return {
        ok: false,
        issues: [
          issue(
            'UPGRADE_RESOLUTION_INVALID',
            path,
            'replacement must preserve every original stable option/edge port id',
          ),
        ],
      };
    return parsed.success
      ? {
          ok: true,
          value: parsed.data,
          notices: [
            issue(
              'UPGRADE_OWNER_DECISION',
              path,
              'explicit owner-selected evaluator and Choice criteria',
            ),
          ],
        }
      : {
          ok: false,
          issues: [issue('UPGRADE_RESOLUTION_INVALID', path, 'decision replacement violates v2')],
        };
  }
  const strategies = config.strategy;
  if (!Array.isArray(strategies) || strategies.length !== 1)
    return {
      ok: false,
      issues: [
        issue(
          'UPGRADE_DECISION_CHOICE_REQUIRED',
          path,
          'mixed fallback chain requires an explicit approved evaluator',
        ),
      ],
    };
  const routes = config.routes as Obj[];
  const options = routes.map((route) => ({
    id: route.label,
    label: route.label,
    criteria: route.description,
  }));
  const ids = new Set(routes.map((route) => String(route.label)));
  const strategy: unknown = strategies[0];
  let evaluation: unknown;
  if (strategy === 'expression') {
    const source = object(config.expression) ? config.expression.jsonata : undefined;
    if (typeof source !== 'string' || !provenStringAnswer(source, ids))
      return {
        ok: false,
        issues: [
          issue(
            'UPGRADE_EXPRESSION_CHOICE_REQUIRED',
            path + '/expression/jsonata',
            'cannot prove a declared string result; approve an explicit tested v2 expression',
          ),
        ],
      };
    evaluation = { kind: 'expression', jsonata: source };
  } else if (strategy === 'jev') {
    const jev = object(config.jev) ? config.jev : {};
    evaluation = {
      kind: 'classifier',
      model: jev.model ?? 'jev',
      question: config.question,
      context: config.context ?? {},
      ...(jev.minConfidence !== undefined ? { minConfidence: jev.minConfidence } : {}),
    };
  } else if (strategy === 'codex') {
    const codex = object(config.codex) ? config.codex : {};
    evaluation = {
      kind: 'llm',
      harness: 'codex',
      question: config.question,
      context: config.context ?? {},
      model:
        codex.model === undefined ? { mode: 'inherit' } : { mode: 'explicit', value: codex.model },
      effort:
        codex.effort === undefined
          ? { mode: 'inherit' }
          : { mode: 'explicit', value: codex.effort },
    };
  } else
    return {
      ok: false,
      issues: [issue('UPGRADE_DECISION_INVALID', path, 'unsupported v1 strategy')],
    };
  const parsed = DecisionConfigSchema.safeParse({
    answer: { type: 'choice', options },
    evaluation,
    recordAlternatives: config.recordAlternatives ?? true,
  });
  return parsed.success
    ? { ok: true, value: parsed.data, notices: [] }
    : {
        ok: false,
        issues: [
          issue(
            'UPGRADE_DECISION_CHOICE_REQUIRED',
            path,
            'old labels/criteria require an explicit valid Choice replacement',
          ),
        ],
      };
}

/** One-off synchronous authoring conversion. Runtime import/admission never calls this. */
export function upgradeLoopV1(
  input: unknown,
  resolutions: UpgradeResolutions = {},
): UpgradeResult<LoopDefinition> {
  const resolutionIssues = validateUpgradeResolutions(resolutions);
  if (resolutionIssues.length) return { ok: false, issues: resolutionIssues };
  if (object(input) && input.schemaVersion === 2) {
    if (
      [resolutions.decisions, resolutions.sources, resolutions.opaqueConsumers].some(
        (value) => value && Object.keys(value).length,
      )
    )
      return {
        ok: false,
        issues: [
          issue(
            'UPGRADE_RESOLUTION_INVALID',
            '/',
            'current v2 definitions require no legacy resolutions',
          ),
        ],
      };
    const current = LoopDefinitionSchema.safeParse(input);
    if (!current.success)
      return {
        ok: false,
        issues: current.error.issues.map((error) =>
          issue(
            'UPGRADE_V2_INVALID',
            '/' + error.path.map(String).map(escape).join('/'),
            error.message,
          ),
        ),
      };
    const syntax = syntaxIssues(current.data);
    if (syntax.length)
      return {
        ok: false,
        issues: syntax.map((error) => issue('UPGRADE_SOURCE_INVALID', error.path, error.message)),
      };
    return { ok: true, value: current.data, notices: [] };
  }
  const legacy = validateJson(LEGACY_V1_SCHEMA.definition, input);
  if (!legacy.ok || !JsonValueSchema.safeParse(input).success)
    return {
      ok: false,
      issues: legacy.issues.length
        ? legacy.issues.map((error) =>
            issue('UPGRADE_V1_INVALID', '/' + error.path.map(escape).join('/'), error.message),
          )
        : [issue('UPGRADE_V1_INVALID', '/', 'expected a JSON v1 definition')],
    };
  const value = clone(input) as Obj;
  const nodes = value.nodes as Obj[];
  const decisionIds = new Set(
    nodes.filter((node) => node.kind === 'decision').map((node) => String(node.id)),
  );
  const subloopIds = new Set(
    nodes.filter((node) => node.kind === 'subloop').map((node) => String(node.id)),
  );
  const resultVars = new Set<string>();
  for (const node of nodes)
    if (
      node.kind === 'subloop' &&
      object(node.config) &&
      object(node.config.output) &&
      object(node.config.output.resultTo) &&
      typeof node.config.output.resultTo.var === 'string'
    )
      resultVars.add(node.config.output.resultTo.var);
  const issues: UpgradeIssue[] = [],
    notices: UpgradeIssue[] = [];
  const sources = sourcesIn(LEGACY_V1_SCHEMA.definition, value);
  const sourcePaths = new Set(sources.map((source) => source.path));
  const opaqueIds = new Set<string>();
  if (decisionIds.size || subloopIds.size)
    nodes.forEach((node, index) => {
      if (
        node.kind !== 'script' ||
        !object(node.config) ||
        !['thread', 'last-output'].includes(String(node.config.stdin))
      )
        return;
      const id = String(node.id);
      opaqueIds.add(id);
      const review = resolutions.opaqueConsumers?.[id];
      if (!review || typeof review.reason !== 'string' || !review.reason.trim())
        issues.push(
          issue(
            'UPGRADE_OPAQUE_CONSUMER_REVIEW_REQUIRED',
            '/nodes/' + index + '/config/stdin',
            'external command consumes the changed thread/output; owner review is required',
          ),
        );
      else
        notices.push(
          issue(
            'UPGRADE_OWNER_OPAQUE_CONSUMER',
            '/nodes/' + index + '/config/stdin',
            review.reason,
          ),
        );
    });
  for (const id of Object.keys(resolutions.opaqueConsumers ?? {}))
    if (!opaqueIds.has(id))
      issues.push(
        issue(
          'UPGRADE_RESOLUTION_INVALID',
          '/nodes',
          'opaque review names no affected consumer: ' + id,
        ),
      );
  for (const key of Object.keys(resolutions.sources ?? {}))
    if (!sourcePaths.has(key))
      issues.push(
        issue('UPGRADE_RESOLUTION_INVALID', key, 'replacement is not an authored source field'),
      );
  for (const key of Object.keys(resolutions.decisions ?? {}))
    if (!decisionIds.has(key))
      issues.push(
        issue('UPGRADE_RESOLUTION_INVALID', '/nodes', 'replacement names no decision node: ' + key),
      );
  for (const source of sources) {
    const sourceNodeIndex = /^\/nodes\/(\d+)\/config(?:\/|$)/.exec(source.path)?.[1];
    if (
      sourceNodeIndex !== undefined &&
      resolutions.decisions?.[String(nodes[Number(sourceNodeIndex)]?.id)] !== undefined
    ) {
      if (resolutions.sources?.[source.path] !== undefined)
        issues.push(
          issue(
            'UPGRADE_RESOLUTION_INVALID',
            source.path,
            'source replacement overlaps a complete decision replacement',
          ),
        );
      continue;
    }
    const replacement = resolutions.sources?.[source.path];
    const selected = replacement ?? source.source;
    const problem =
      source.kind === 'expression' ? checkExpression(selected) : checkTemplate(selected);
    if (problem !== null)
      issues.push(issue('UPGRADE_SOURCE_INVALID', source.path, 'authored source does not parse'));
    else if (
      replacement === undefined &&
      uncertainOutputAccess(selected, decisionIds, source.kind, subloopIds, resultVars)
    )
      issues.push(
        issue(
          'UPGRADE_REFERENCE_CHOICE_REQUIRED',
          source.path,
          'cannot prove unchanged literal output access; approve a reviewed source replacement',
        ),
      );
    if (replacement !== undefined) {
      setSource(value, source.path, replacement);
      notices.push(
        issue(
          'UPGRADE_OWNER_SOURCE',
          source.path,
          'explicit owner-reviewed authored source replacement',
        ),
      );
    }
  }
  nodes.forEach((node, index) => {
    if (node.kind !== 'decision') return;
    const converted = convertDecision(
      node.config as Obj,
      '/nodes/' + index + '/config',
      resolutions.decisions?.[String(node.id)],
    );
    if (converted.ok) {
      node.config = converted.value;
      notices.push(...converted.notices);
    } else issues.push(...converted.issues);
  });
  const settings = object(value.settings) ? value.settings : {};
  const defaults = upgradeDefaultsV1(settings.defaults ?? {});
  if (defaults.ok) settings.defaults = defaults.value;
  else issues.push(...defaults.issues);
  value.settings = settings;
  value.schemaVersion = 2;
  if (issues.length) return { ok: false, issues };
  const parsed = LoopDefinitionSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((error) =>
        issue(
          'UPGRADE_V2_INVALID',
          '/' + error.path.map(String).map(escape).join('/'),
          error.message,
        ),
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

export function upgradeExportV1(
  input: unknown,
  resolutions: UpgradeResolutions = {},
): UpgradeResult<LoopExport> {
  if (
    !object(input) ||
    input.format !== 'graphgoblin-loop' ||
    input.formatVersion !== 1 ||
    Object.keys(input).some(
      (key) => !['format', 'formatVersion', 'exportedAt', 'loop'].includes(key),
    )
  )
    return {
      ok: false,
      issues: [issue('UPGRADE_V1_INVALID', '/', 'expected the exact v1 portable export envelope')],
    };
  const result = upgradeLoopV1(input.loop, resolutions);
  if (!result.ok) return result;
  const parsed = LoopExportSchema.safeParse({ ...input, formatVersion: 2, loop: result.value });
  return parsed.success
    ? { ok: true, value: parsed.data, notices: result.notices }
    : {
        ok: false,
        issues: [issue('UPGRADE_V1_INVALID', '/exportedAt', 'invalid export timestamp')],
      };
}
