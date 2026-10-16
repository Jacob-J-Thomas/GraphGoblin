import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  V3LoopDefinitionSchema,
  V3LoopSettingsSchema,
  V3NodeConfigSchemas,
  V3TemplateSchema,
  V3ExpressionSchema,
  V3DecisionConfigSchema,
  type V3LoopDefinition,
  type V3DecisionConfig,
  type LoopDefinition,
  type DecisionConfig,
} from '@graphgoblin/contracts';
import { validateLoop } from '../graph.js';
import { decisionRouteDeclarations } from '../answers.js';
import { findAuthoredSources, syntaxIssues } from '../syntax.js';
import {
  consumerNeedsReview,
  rewriteLastOutput,
  proposeAnswerConsumer,
  iterationConsumer,
} from './consumers.js';
import {
  DefinitionReview,
  definitionReviewHash,
  problem,
  type DefinitionResolutions,
  type DefinitionReviewItem,
} from './review.js';
import type { UpgradeIssue } from '../upgrade.js';
export { canonicalReviewValue, definitionReviewHash } from './review.js';
export type {
  DefinitionResolutions,
  DefinitionResolution,
  DefinitionReviewItem,
} from './review.js';

type V3Node = V3LoopDefinition['nodes'][number];
type Obj = Record<string, unknown>;
function knownOutputWriter(node: V3Node): boolean {
  return (
    ['trigger', 'decision', 'wait', 'heartbeat'].includes(node.kind) ||
    (node.kind === 'script' && node.config.stdout === 'last-output') ||
    (node.kind === 'inference' && node.config.output.transforms.length === 0)
  );
}
function canRewriteOutputContainers(node: V3Node): boolean {
  if (node.kind === 'script') return node.config.stdout === 'patch';
  if (node.kind === 'subloop') return node.config.output.mode === 'custom';
  const operations =
    node.kind === 'mutate'
      ? node.config.operations
      : node.kind === 'inference'
        ? [...node.config.input, ...node.config.output.transforms]
        : [];
  return operations.some((operation) => {
    const path =
      operation.op === 'set' || operation.op === 'delete'
        ? operation.path
        : operation.op === 'coerce'
          ? operation.target
          : null;
    return (
      path !== null &&
      (path === '' ||
        path === '/outputs' ||
        path.startsWith('/outputs/') ||
        path === '/lastOutput' ||
        path.startsWith('/lastOutput/'))
    );
  });
}
export type DefinitionConversionResult =
  | { ok: true; value: LoopDefinition; reviewItems: DefinitionReviewItem[]; ready: boolean }
  | { ok: false; issues: UpgradeIssue[]; reviewItems: DefinitionReviewItem[] };
const clone = <T>(value: T): T => structuredClone(value);
const ptr = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const outputRef = (id: string) => 'outputs.' + (id.includes('-') ? '`' + id + '`' : id);
const routes = (answer: V3DecisionConfig['answer']) =>
  (answer.type === 'choice'
    ? answer.options
    : answer.type === 'noul'
      ? [answer.true, answer.false]
      : answer.bands
  ).map(({ id, label }) => ({ id, label }));

/** Once-only strict boolean mapping, including undefined and non-boolean failure behavior. */
export function booleanRouteExpression(source: string, yes: string, no: string): string {
  return `($v := (${source}); $type($v) = "boolean" ? ($v ? ${JSON.stringify(yes)} : ${JSON.stringify(no)}) : $error("Expected a boolean"))`;
}

async function decision(
  config: V3DecisionConfig,
  nodeId: string,
  path: string,
  review: DefinitionReview,
): Promise<unknown> {
  const { answer, evaluation, recordAlternatives } = config;
  if (evaluation.kind === 'classifier') {
    return review.change(
      nodeId,
      path,
      'classifier-decision',
      config,
      { ...evaluation, answer, recordAlternatives },
      'Flatten classifier configuration; preserve all mathematics and route identities.',
      false,
    );
  }
  const declared = routes(answer);
  await review.change(
    nodeId,
    path,
    'unused-controls',
    { answer, recordAlternatives },
    declared,
    'Remove unused classifier criteria and recording controls from expression/LLM decisions.',
    false,
  );
  if (evaluation.kind === 'expression') {
    if (answer.type === 'score') return null; // Rejected by the frozen parser.
    return {
      kind: 'expression',
      routes: declared,
      jsonata:
        answer.type === 'choice'
          ? evaluation.jsonata
          : booleanRouteExpression(evaluation.jsonata, answer.true.id, answer.false.id),
    };
  }
  const criteria =
    answer.type === 'choice'
      ? answer.options
      : answer.type === 'noul'
        ? [answer.true, answer.false]
        : [];
  const candidate =
    evaluation.question +
    '\n\nChoose exactly one route id using these criteria:\n' +
    criteria.map((side) => `${side.id} (${side.label}): ${side.criteria}`).join('\n');
  const instructions = await review.change(
    nodeId,
    path + '/evaluation/question',
    'llm-instructions',
    { question: evaluation.question, answer },
    candidate,
    'Owner must review the complete instruction derived from the question and criteria; judgment equivalence is not assumed.',
  );
  const { question: _question, ...selection } = evaluation;
  return { ...selection, routes: declared, instructions };
}

/** A unique nearest output writer on every incoming path; cycles and merges fail closed. */
function producer(def: V3LoopDefinition, id: string, seen = new Set<string>()): string | null {
  if (seen.has(id)) return null;
  const nextSeen = new Set([...seen, id]);
  const incoming = def.edges.filter((edge) => edge.to.node === id);
  if (!incoming.length) return null;
  const producers = incoming.map((edge) => {
    const node = def.nodes.find((entry) => entry.id === edge.from.node);
    if (!node) return null;
    if (knownOutputWriter(node)) return node.id;
    // Mutations and subloops can write/copy/conditionally suppress output: require evidence.
    return node.kind === 'exit' ? producer(def, node.id, nextSeen) : null;
  });
  return producers[0] && producers.every((entry) => entry === producers[0]) ? producers[0] : null;
}

function allocate(used: Set<string>, base: string): string {
  let value = base.slice(0, 64),
    suffix = 1;
  while (used.has(value)) value = base.slice(0, 54) + '-' + suffix++;
  used.add(value);
  return value;
}

type V3Exit = Extract<V3Node, { kind: 'exit' }>;
function planExit(node: V3Exit, used: Set<string>) {
  const config = node.config,
    back = config.default === 'loop-back';
  const predicates = config.criteria.filter((criterion) => criterion.when === 'predicate');
  const constant = predicates[0];
  if (
    config.criteria.some((criterion) => criterion.when === 'last-output-matches') ||
    (!back &&
      (!predicates.length ||
        config.criteria.some(
          (criterion) => criterion.when === 'max-iterations' || criterion.when === 'max-duration',
        ) ||
        (config.criteria.length === 1 &&
          constant?.evaluation.kind === 'expression' &&
          constant.match.type === 'noul' &&
          constant.evaluation.jsonata.trim() === String(constant.match.value))))
  )
    return null;
  const finish = allocate(used, node.id + '-complete');
  const exhausted = back ? allocate(used, node.id + '-exhausted') : null;
  const entries = predicates.map((_, index) =>
    index === 0 ? node.id : allocate(used, node.id + '-check-' + (index + 1)),
  );
  const checks = predicates.map((predicate, index) => ({
    entry: entries[index]!,
    matched: allocate(used, node.id + '-matched-' + (index + 1)),
    compare:
      predicate.evaluation.kind === 'expression'
        ? null
        : allocate(used, entries[index]! + '-match'),
  }));
  const last = checks.at(-1);
  return {
    finish,
    exhausted,
    checks,
    gateId: back ? (last ? (last.compare ?? last.entry) : node.id) : null,
  };
}

/** Keep explicit authored fields; carry reviewed source edits into unchanged generated fields. */
function carrySourceEdits(authored: unknown, baseline: unknown, revised: unknown): unknown {
  if (authored === baseline) return revised;
  if (
    !authored ||
    !baseline ||
    !revised ||
    typeof authored !== 'object' ||
    typeof baseline !== 'object' ||
    typeof revised !== 'object' ||
    Array.isArray(authored) ||
    Array.isArray(baseline) ||
    Array.isArray(revised)
  )
    return authored;
  const result = { ...authored } as Obj;
  for (const key of Object.keys(result))
    if (Object.hasOwn(baseline, key) && Object.hasOwn(revised, key))
      result[key] = carrySourceEdits(result[key], (baseline as Obj)[key], (revised as Obj)[key]);
  return result;
}

/** Definition-only stage. `ready` is false until every required owner review is resolved.
 * No history, store, API, configured-instance retirement or offline-tool composition occurs here.
 */
export async function convertDefinitionV3ToV4(
  input: V3LoopDefinition,
  resolutions: DefinitionResolutions = {},
): Promise<DefinitionConversionResult> {
  if (
    resolutions &&
    typeof resolutions === 'object' &&
    !Array.isArray(resolutions) &&
    Object.keys(resolutions).some((id) => id.endsWith(':iteration-consumer'))
  ) {
    const baselineResolutions = Object.fromEntries(
      Object.entries(resolutions).filter(([id]) => !id.endsWith(':iteration-consumer')),
    );
    const baseline = await convertDefinition(input, baselineResolutions);
    return convertDefinition(input, resolutions, baseline.reviewItems);
  }
  return convertDefinition(input, resolutions);
}

async function convertDefinition(
  input: V3LoopDefinition,
  resolutions: DefinitionResolutions,
  baselineItems: DefinitionReviewItem[] = [],
): Promise<DefinitionConversionResult> {
  const parsed = V3LoopDefinitionSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: [problem('V3_DEFINITION_INVALID', '/', 'expected a frozen format-3 definition')],
      reviewItems: [],
    };
  if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions))
    return {
      ok: false,
      issues: [problem('V4_RESOLUTION_INVALID', '/', 'expected a resolution map')],
      reviewItems: [],
    };
  const source = clone(parsed.data);
  const review = new DefinitionReview(source, resolutions);
  const frozen = {
    settings: V3LoopSettingsSchema,
    nodes: V3NodeConfigSchemas,
    template: V3TemplateSchema,
    expression: V3ExpressionSchema,
  };
  const syntax = syntaxIssues(source, frozen);
  if (syntax.length)
    return {
      ok: false,
      issues: syntax.map((entry) => problem('V3_SOURCE_INVALID', entry.path, entry.message)),
      reviewItems: [],
    };
  const nodes: Obj[] = [],
    edges = clone(source.edges);
  const nodeIds = new Set(source.nodes.map((node) => node.id));
  const loopBacks = source.nodes.filter(
    (node) => node.kind === 'exit' && node.config.default === 'loop-back',
  );
  const exitPlans = new Map(
    source.nodes.flatMap((node) =>
      node.kind === 'exit' ? [[node.id, planExit(node, nodeIds)] as const] : [],
    ),
  );
  const iterationGateId =
    loopBacks.length === 1 ? (exitPlans.get(loopBacks[0]!.id)?.gateId ?? null) : null;
  const iterationItems = new Set<string>();
  const authoredGraphs = source.nodes.flatMap((node, index) => {
    const resolution = resolutions[`/nodes/${index}/config:exit-policy`];
    return node.kind === 'exit' && resolution?.action === 'replace' ? [resolution.value] : [];
  });
  const expectedGates = source.nodes.flatMap((node, index) => {
    if (node.kind !== 'exit') return [];
    const resolution = resolutions[`/nodes/${index}/config:exit-policy`];
    if (resolution?.action === 'replace') {
      const fragment = resolution.value as { nodes?: unknown } | null;
      return fragment && Array.isArray(fragment.nodes)
        ? fragment.nodes.flatMap((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return [];
            const candidate = entry as Obj,
              config = candidate.config as Obj | null;
            return candidate.kind === 'decision' &&
              config &&
              typeof config === 'object' &&
              config.maxPasses !== undefined
              ? [candidate.id]
              : [];
          })
        : [];
    }
    const gateId = exitPlans.get(node.id)?.gateId;
    return gateId ? [gateId] : [];
  });
  const iterationProofInvalid =
    iterationGateId !== null &&
    (expectedGates.length !== 1 || expectedGates[0] !== iterationGateId);
  const authoredGraphHash = iterationProofInvalid
    ? await definitionReviewHash(authoredGraphs)
    : null;
  const edgeIds = new Set(source.edges.map((edge) => edge.id));
  const settings: Obj = clone(source.settings);
  delete settings.maxIterations;
  settings.maxNodeVisits = source.settings.maxIterations;
  const link = (from: string, port: string, to: string) =>
    edges.push({
      id: allocate(edgeIds, `${from}-${port}`),
      from: { node: from, port },
      to: { node: to, port: 'in' },
    });
  const changedOutput = source.nodes.some(
    (node) =>
      node.kind === 'decision' ||
      (node.kind === 'exit' &&
        (node.config.default === 'loop-back' || node.config.criteria.length > 0)),
  );
  const safeOutputs = new Set(
    source.nodes
      .filter(
        (node) =>
          !source.nodes.some(canRewriteOutputContainers) &&
          node.kind !== 'decision' &&
          knownOutputWriter(node),
      )
      .map((node) => node.id),
  );
  const decisions = new Map(
    source.nodes.flatMap((node) =>
      node.kind === 'decision' ? [[node.id, node.config] as const] : [],
    ),
  );

  async function runtimeCounterSource(
    text: string,
    kind: 'expression' | 'template',
    nodeId: string | null,
    path: string,
  ): Promise<unknown> {
    const state = iterationConsumer(text, kind, iterationGateId);
    if (!state.needed) return text;
    if (state.automatic) iterationItems.add(path + ':iteration-consumer');
    return review.change(
      nodeId,
      path,
      state.automatic ? 'iteration-consumer' : 'output-consumer',
      text,
      state.proposed,
      state.automatic
        ? iterationProofInvalid
          ? 'The authored graph invalidates the single-gate iteration proof. Replace this source explicitly; approval of the automatic proposal is insufficient. Authored graph SHA-256: ' +
            authoredGraphHash
          : "Replace the old one-based shared iteration with the sole repeat gate's one-based passes. The engine seeds this maxPasses gate at 1 before execution."
        : 'run.iteration stays 1 in fresh format-4 runs; counters and iteration without a unique proven repeat gate require an owner-authored source resolution.',
      !state.automatic || iterationProofInvalid,
      true,
      state.automatic && iterationProofInvalid,
    );
  }

  async function exitPolicy(
    original: V3Exit,
    path: string,
    nodeStart: number,
    proposal: { nodes: Obj[]; edges: V3LoopDefinition['edges'] } | null,
    requiredCode?: string,
  ) {
    const id = path + ':exit-policy';
    const baseline = baselineItems.find((item) => item.id === id);
    const graph = await review.change(
      original.id,
      path,
      'exit-policy',
      original.config,
      baseline ? baseline.proposedValue : proposal,
      proposal === null
        ? 'Supply an authored current exit graph. Preserve ordered criteria and return semantics; do not approximate JSON Schema or historical iteration counters.'
        : 'Review terminal outcomes, captures, return mapping, ordered-criterion timing and independent gate budgets. Gate limits run after evaluation and only on repeat; no history/replay entry is approved by this definition rule.',
    );
    const replacement = resolutions[id];
    if (
      requiredCode &&
      (replacement?.action !== 'replace' || review.items.at(-1)?.status !== 'resolved')
    )
      review.issues.push(
        problem(
          requiredCode,
          path,
          'An authored graph replacement is required; resolve review item ' + id,
        ),
      );
    if (replacement?.action !== 'replace') return;
    if (
      Object.keys(resolutions).some(
        (key) =>
          key.startsWith(path + '/') &&
          resolutions[key]?.action === 'replace' &&
          !(iterationProofInvalid && iterationItems.has(key)),
      )
    )
      review.issues.push(
        problem('V4_RESOLUTION_CONFLICT', path, 'graph replacement overlaps source replacements'),
      );
    const fragment = graph as { nodes?: unknown; edges?: unknown } | null;
    if (
      !fragment ||
      typeof fragment !== 'object' ||
      Object.keys(fragment).some((key) => !['nodes', 'edges'].includes(key)) ||
      !Array.isArray(fragment.nodes) ||
      !Array.isArray(fragment.edges)
    ) {
      review.issues.push(
        problem(
          'V4_RESOLUTION_INVALID',
          path,
          'expected an exit graph fragment with nodes and edges',
        ),
      );
      return;
    }
    const baselineGraph = baseline?.proposedValue as { nodes?: Obj[] } | null | undefined;
    const authoredNodes = fragment.nodes.map((node: unknown) => {
      if (!node || typeof node !== 'object') return node;
      const before = baselineGraph?.nodes?.find((entry) => entry.id === (node as Obj).id);
      const after = proposal?.nodes.find((entry) => entry.id === (node as Obj).id);
      return before && after ? carrySourceEdits(node, before, after) : node;
    });
    const checked = LoopDefinitionSchema.safeParse({
      ...source,
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      settings,
      nodes: authoredNodes,
      edges: fragment.edges,
    });
    if (
      !checked.success ||
      !checked.data.nodes.some((node) => node.id === original.id) ||
      checked.data.nodes.some(
        (node) => node.id !== original.id && source.nodes.some((old) => old.id === node.id),
      ) ||
      checked.data.edges.some(
        (edge) => !checked.data.nodes.some((node) => node.id === edge.from.node),
      )
    ) {
      review.issues.push(
        problem(
          'V4_RESOLUTION_INVALID',
          path,
          'fragment must retain the exit entry id and own its nodes and outgoing edges',
        ),
      );
      return;
    }
    const fragmentIds = new Set(proposal?.nodes.map((node) => node.id) ?? []);
    nodes.splice(nodeStart, nodes.length - nodeStart, ...checked.data.nodes);
    for (let index = edges.length - 1; index >= 0; index--)
      if (fragmentIds.has(edges[index]!.from.node)) edges.splice(index, 1);
    edges.push(...checked.data.edges);
    for (const node of checked.data.nodes)
      if (node.kind === 'decision' && node.config.maxPasses !== undefined)
        settings.maxNodeVisits = Math.max(Number(settings.maxNodeVisits), node.config.maxPasses);
  }

  // Walk the frozen schemas, then locate exact leaves without treating dots in record keys as separators.
  async function consumers(
    value: unknown,
    schema: unknown,
    nodeId: string | null,
    base: string,
  ): Promise<unknown> {
    const authored = findAuthoredSources(schema, value, frozen);
    const visit = async (entry: unknown, dotted: string, pointer: string): Promise<unknown> => {
      const found = authored.find((item) => item.path === dotted && item.source === entry);
      if (found) {
        const transformed = await runtimeCounterSource(found.source, found.kind, nodeId, pointer);
        if (typeof transformed !== 'string') return transformed;
        if (review.items.at(-1)?.id === pointer + ':output-consumer') return transformed;
        if (changedOutput && consumerNeedsReview(transformed, found.kind, safeOutputs, false, true))
          return review.change(
            nodeId,
            pointer,
            'output-consumer',
            transformed,
            proposeAnswerConsumer(
              transformed,
              found.kind,
              decisions,
              nodeId ? producer(source, nodeId) : null,
            ),
            'Review the static-path proposal and trace all captured values to their producer. Dynamic paths, removed fields, aliases and whole outputs require explicit evidence or a replacement.',
          );
        return transformed;
      }
      if (Array.isArray(entry)) {
        const result: unknown[] = [];
        for (const [index, child] of entry.entries())
          result.push(
            await visit(
              child,
              dotted ? `${dotted}.${index}` : String(index),
              pointer + '/' + index,
            ),
          );
        return result;
      }
      if (entry && typeof entry === 'object') {
        const result: Obj = {};
        for (const [key, child] of Object.entries(entry))
          result[key] = await visit(
            child,
            dotted ? dotted + '.' + key : key,
            pointer + '/' + ptr(key),
          );
        return result;
      }
      return entry;
    };
    const result = await visit(value, '', base);
    return result;
  }

  for (const [index, original] of source.nodes.entries()) {
    const path = `/nodes/${index}/config`;
    if (original.kind !== 'exit') {
      let config = await consumers(
        original.config,
        V3NodeConfigSchemas[original.kind],
        original.id,
        path,
      );
      if (!V3NodeConfigSchemas[original.kind].safeParse(config).success) {
        review.issues.push(
          problem(
            'V4_RESOLUTION_INVALID',
            path,
            'consumer replacement violates the frozen source configuration',
          ),
        );
        continue;
      }
      if (
        changedOutput &&
        (original.kind === 'script' ||
          original.kind === 'subloop' ||
          original.kind === 'mutate' ||
          original.kind === 'inference')
      )
        config = await review.change(
          original.id,
          path,
          'opaque-consumer',
          original.config,
          config,
          'Review scripts, input/output transforms, mutation pointers/literals, schemas and subloop boundaries for whole-thread reads, copies and aliases.',
        );
      const opaque = resolutions[path + ':opaque-consumer'];
      if (
        opaque?.action === 'replace' &&
        Object.keys(resolutions).some((key) => key.startsWith(path + '/'))
      )
        review.issues.push(
          problem(
            'V4_RESOLUTION_CONFLICT',
            path,
            'whole-config replacement overlaps source resolutions',
          ),
        );
      if (original.kind === 'decision') {
        const converted = await decision(config as V3DecisionConfig, original.id, path, review);
        nodes.push({ ...clone(original), config: converted });
      } else if (original.kind === 'trigger') {
        // Analyse and validate frozen V3 fields before emitting the current discriminator.
        const { subtype, ...fields } = V3NodeConfigSchemas.trigger.parse(config);
        nodes.push({ ...clone(original), config: { type: subtype, ...fields } });
      } else nodes.push({ ...clone(original), config });
      continue;
    }
    const nodeStart = nodes.length;
    const config = original.config;
    const back = config.default === 'loop-back';
    const oldExitEdges = edges.filter((edge) => edge.from.node === original.id);
    if (
      oldExitEdges.some(
        (edge) => edge.from.port !== 'loopBack' || edge.to.node !== config.loopBack?.targetNodeId,
      ) ||
      oldExitEdges.length > 1
    ) {
      review.issues.push(
        problem(
          'V3_EXIT_EDGE',
          path,
          'old exit output edges cannot be assigned terminal meaning automatically',
        ),
      );
      continue;
    }
    for (const edge of oldExitEdges) edges.splice(edges.indexOf(edge), 1);
    if (!back && (config.loopBack || oldExitEdges.length))
      await review.change(
        original.id,
        path + '/loopBack',
        'ignored-loop-back',
        { loopBack: config.loopBack ?? null, edges: oldExitEdges },
        null,
        'Review removal of ignored continuation configuration.',
        true,
        false,
      );
    const work = producer(source, original.id);
    let mapping: unknown = config.return.mapping;
    if (config.return.mapping !== 'none') {
      const returnSource = await runtimeCounterSource(
        config.return.mapping,
        'expression',
        original.id,
        path + '/return/mapping',
      );
      if (typeof returnSource !== 'string') {
        review.issues.push(
          problem(
            'V4_RESOLUTION_INVALID',
            path + '/return/mapping',
            'return source replacement must be a string',
          ),
        );
        continue;
      }
      const proven = work !== null && safeOutputs.has(work);
      const proposed = !consumerNeedsReview(returnSource, 'expression', safeOutputs, proven, true)
        ? rewriteLastOutput(returnSource, outputRef(work ?? 'unproven'))
        : null;
      const answerProposal = proposeAnswerConsumer(returnSource, 'expression', decisions, work);
      mapping = await review.change(
        original.id,
        path + '/return/mapping',
        'exit-return',
        mapping,
        proposed ??
          (work
            ? (rewriteLastOutput(answerProposal, outputRef(work)) ?? answerProposal)
            : answerProposal),
        proposed !== null
          ? 'Bind lastOutput to the unique incoming output producer before new decisions overwrite it.'
          : 'Return producer is unproven or dynamic; author an explicit mapping with producer evidence.',
        proposed === null,
      );
    }
    const terminal = (id: string, outcome: string) =>
      nodes.push({
        ...clone(original),
        id,
        kind: 'exit',
        config: { outcome, returns: mapping, destinations: clone(config.return.channels) },
      });
    const predicates = config.criteria.filter((criterion) => criterion.when === 'predicate');
    for (const [criterionIndex, criterion] of config.criteria.entries()) {
      if (
        (criterion.when === 'max-iterations' || criterion.when === 'max-duration') &&
        config.criteria.slice(criterionIndex + 1).some((later) => later.when === 'predicate')
      )
        await review.change(
          original.id,
          `${path}/criteria/${criterionIndex}`,
          'ordered-limit',
          criterion,
          { timing: 'after-evaluation-on-repeat', criterion },
          'This V3 limit preceded a predicate and could exhaust before that predicate ran. Generated gates evaluate first, then check limits only on a repeat. Review this order change or preserve it in an authored graph.',
          true,
          false,
        );
    }
    const constant = predicates[0];
    if (
      !back &&
      config.criteria.length === 1 &&
      constant?.evaluation.kind === 'expression' &&
      constant.match.type === 'noul' &&
      constant.evaluation.jsonata.trim() === String(constant.match.value)
    ) {
      terminal(original.id, constant.outcome);
      await review.change(
        original.id,
        path,
        'constant-terminal',
        config,
        { outcome: constant.outcome, returns: mapping, destinations: config.return.channels },
        'A literal boolean match always terminates with this outcome.',
        false,
      );
      continue;
    }
    if (config.criteria.some((criterion) => criterion.when === 'last-output-matches')) {
      await exitPolicy(original, path, nodeStart, null, 'V4_EXIT_SCHEMA_POLICY_REQUIRED');
      continue;
    }
    const ceilings = config.criteria
      .filter((criterion) => criterion.when === 'max-iterations')
      .map((criterion) => criterion.value);
    const durations = config.criteria
      .filter((criterion) => criterion.when === 'max-duration')
      .map((criterion) => criterion.seconds);
    if (!back && (ceilings.length || durations.length)) {
      await exitPolicy(original, path, nodeStart, null, 'V4_TERMINAL_LIMIT_POLICY_REQUIRED');
      continue;
    }
    if (!back && !predicates.length) {
      terminal(original.id, 'success');
      continue;
    }
    const maxPasses = Math.min(source.settings.maxIterations, ...ceilings);
    const limits = {
      maxPasses,
      ...(durations.length ? { maxRunTimeSeconds: Math.min(...durations) } : {}),
    };
    if (back) settings.maxNodeVisits = Math.max(Number(settings.maxNodeVisits), maxPasses);
    const plan = exitPlans.get(original.id)!;
    if (!plan) throw new Error('missing generated exit plan');
    const { finish, exhausted } = plan;
    if (!back || !predicates.length) terminal(finish, 'success');
    if (exhausted) terminal(exhausted, 'exhausted');
    const checks = plan.checks.map((check) => check.entry);
    if (!checks.length) checks.push(original.id);
    if (!predicates.length) {
      nodes.push({
        ...clone(original),
        kind: 'decision',
        config: {
          kind: 'expression',
          jsonata: '"repeat"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'finish', label: 'Finish' },
          ],
          ...limits,
        },
      });
      if (oldExitEdges[0])
        edges.push({ ...oldExitEdges[0], from: { node: original.id, port: 'repeat' } });
      else link(original.id, 'repeat', config.loopBack!.targetNodeId);
      link(original.id, 'finish', finish);
      link(original.id, 'limit-reached', exhausted!);
    }
    if (back && loopBacks.length > 1)
      await review.change(
        plan.gateId,
        path,
        'shared-iteration-budget',
        {
          maxIterations: source.settings.maxIterations,
          loopBackExitIds: loopBacks.map((node) => node.id),
        },
        limits,
        'V3 shared one iteration budget across all loop-back exits. This generated gate now has an independent pass budget; several or nested gates can run longer or reach MAX_NODE_VISITS. Review the combined budget.',
        true,
        false,
      );
    for (const [position, predicate] of predicates.entries()) {
      const criterionIndex = config.criteria.indexOf(predicate);
      const predicatePath = `${path}/criteria/${criterionIndex}`;
      const id = checks[position]!;
      const last = position === predicates.length - 1;
      const matched = plan.checks[position]!.matched;
      terminal(matched, predicate.outcome);
      const noMatch = !last ? checks[position + 1]! : back ? config.loopBack!.targetNodeId : finish;
      let evaluated: Obj;
      if (predicate.evaluation.kind === 'expression') {
        const raw = await runtimeCounterSource(
          predicate.evaluation.jsonata,
          'expression',
          original.id,
          predicatePath + '/evaluation/jsonata',
        );
        if (typeof raw !== 'string') {
          review.issues.push(
            problem(
              'V4_RESOLUTION_INVALID',
              predicatePath,
              'predicate source replacement must be a string',
            ),
          );
          continue;
        }
        const rewritten = work ? rewriteLastOutput(raw, outputRef(work)) : null;
        const jsonata = await review.change(
          original.id,
          predicatePath + '/evaluation/jsonata',
          'predicate-input',
          raw,
          proposeAnswerConsumer(rewritten ?? raw, 'expression', decisions, work),
          'Expression predicates retain threadView semantics; bind lastOutput to the proven work output before inserted decisions overwrite it. Unproven/dynamic sources require review.',
          rewritten === null ||
            consumerNeedsReview(
              raw,
              'expression',
              safeOutputs,
              work !== null && safeOutputs.has(work),
              true,
            ),
        );
        if (typeof jsonata !== 'string') {
          review.issues.push(
            problem(
              'V4_RESOLUTION_INVALID',
              predicatePath,
              'predicate expression replacement must be a string',
            ),
          );
          continue;
        }
        const match = predicate.match.type === 'noul' && predicate.match.value;
        evaluated = {
          kind: 'expression',
          routes: [
            { id: 'matched', label: 'Matched' },
            { id: 'unmatched', label: 'Unmatched' },
          ],
          jsonata: booleanRouteExpression(
            jsonata,
            match ? 'matched' : 'unmatched',
            match ? 'unmatched' : 'matched',
          ),
        };
      } else {
        const question = await runtimeCounterSource(
          predicate.evaluation.question,
          'template',
          original.id,
          predicatePath + '/evaluation/question',
        );
        if (typeof question !== 'string') {
          review.issues.push(
            problem(
              'V4_RESOLUTION_INVALID',
              predicatePath,
              'provider question replacement must be a string',
            ),
          );
          continue;
        }
        const sides =
          predicate.answer.type === 'noul' && 'true' in predicate.answer ? predicate.answer : null;
        const answer = sides
          ? {
              ...sides,
              true: { ...sides.true, id: 'true' },
              false: { ...sides.false, id: 'false' },
            }
          : predicate.answer.type === 'score'
            ? {
                ...predicate.answer,
                bands: [
                  { id: 'score', label: 'Score', min: 0, max: predicate.answer.anchors.length - 1 },
                ],
              }
            : predicate.answer;
        const v3config = V3DecisionConfigSchema.parse({
          answer,
          evaluation: {
            ...predicate.evaluation,
            question,
            context: { messages: 'last', includeLastOutput: true },
          },
          recordAlternatives: true,
        });
        evaluated = (await decision(v3config, original.id, predicatePath, review)) as Obj;
        await review.change(
          original.id,
          predicatePath,
          'provider-predicate',
          predicate,
          evaluated,
          'Review old bare lastOutput/provider state, classifier rejection (now failure), matching and generated graph. Provider prompts/state may require explicit captures.',
          true,
          false,
        );
        if (
          'minReportedConfidence' in predicate.match &&
          predicate.match.minReportedConfidence !== undefined
        )
          await review.change(
            original.id,
            predicatePath + '/match/minReportedConfidence',
            'llm-confidence',
            predicate.match.minReportedConfidence,
            null,
            'Individually approve removal of the old LLM confidence gate; confidence is informational, including an old zero threshold.',
            true,
            false,
          );
        // Preserve primitive routes, then compare the observed result without recomputing it.
        const compare = plan.checks[position]!.compare!;
        const current = evaluated as DecisionConfig;
        for (const route of decisionRouteDeclarations(current)) link(id, route.id, compare);
        nodes.push({ ...clone(original), id, kind: 'decision', config: evaluated });
        const observation = `${outputRef(id)}.value.observation`;
        let test: string;
        if (predicate.match.type === 'noul')
          test =
            predicate.evaluation.kind === 'llm'
              ? `${observation}.routeId = ${JSON.stringify(String(predicate.match.value))}`
              : `${observation}.answer.holds = ${predicate.match.value}`;
        else if (predicate.match.type === 'choice')
          test = `${predicate.evaluation.kind === 'llm' ? observation + '.routeId' : observation + '.answer.optionId'} in ${JSON.stringify(predicate.match.optionIds)}`;
        else {
          const operators = { lt: '<', lte: '<=', eq: '=', gte: '>=', gt: '>' };
          test = `${observation}.answer.score ${operators[predicate.match.operator]} ${predicate.match.value}`;
        }
        evaluated = {
          kind: 'expression',
          jsonata: `(${test}) ? "matched" : "unmatched"`,
          routes: [
            { id: 'matched', label: 'Matched' },
            { id: 'unmatched', label: 'Unmatched' },
          ],
        };
        checks[position] = compare;
      }
      const checkId = checks[position]!;
      if (last && back) {
        (evaluated.routes as Obj[]).find((route) => route.id === 'unmatched')!.repeat = true;
        Object.assign(evaluated, limits);
        link(checkId, 'limit-reached', exhausted!);
      }
      nodes.push({ ...clone(original), id: checkId, kind: 'decision', config: evaluated });
      link(checkId, 'matched', matched);
      if (last && back && oldExitEdges[0])
        edges.push({ ...oldExitEdges[0], from: { node: checkId, port: 'unmatched' } });
      else link(checkId, 'unmatched', noMatch);
    }
    const fragmentNodes = nodes.slice(nodeStart);
    const fragmentIds = new Set(fragmentNodes.map((node) => node.id));
    const fragmentEdges = edges.filter((edge) => fragmentIds.has(edge.from.node));
    await exitPolicy(original, path, nodeStart, { nodes: fragmentNodes, edges: fragmentEdges });
  }
  const convertedSettings = await consumers(settings, V3LoopSettingsSchema, null, '/settings');
  const variables =
    changedOutput && Object.keys(source.variables).length
      ? await review.change(
          null,
          '/variables',
          'variable-schemas',
          source.variables,
          source.variables,
          'Review variable schemas/defaults and captured decision payloads for answer.* and whole-output assumptions.',
        )
      : source.variables;
  const result = LoopDefinitionSchema.safeParse({
    ...clone(source),
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    settings: convertedSettings,
    variables,
    nodes,
    edges,
  });
  if (!result.success)
    review.issues.push(
      ...result.error.issues.map((entry) =>
        problem('V4_DEFINITION_INVALID', '/' + entry.path.map(String).join('/'), entry.message),
      ),
    );
  else {
    if (
      iterationItems.size > 0 &&
      (result.data.nodes.filter(
        (node) => node.kind === 'decision' && node.config.maxPasses !== undefined,
      ).length !== 1 ||
        !result.data.nodes.some(
          (node) =>
            node.id === iterationGateId &&
            node.kind === 'decision' &&
            node.config.maxPasses !== undefined,
        ))
    ) {
      const pending = review.items.filter(
        (item) =>
          iterationItems.has(item.id) &&
          (item.status !== 'resolved' || resolutions[item.id]?.action !== 'replace'),
      );
      if (pending.length)
        review.issues.push(
          problem(
            'V4_ITERATION_GATE_UNPROVEN',
            '/',
            'The authored graph invalidates the automatic iteration proof. Supply hash-bound source replace resolutions for: ' +
              pending.map((item) => item.id).join(', '),
          ),
        );
    }
    review.issues.push(
      ...validateLoop(result.data)
        .filter((entry) => entry.severity === 'error')
        .map((entry) => problem(entry.code, entry.path ?? '/', entry.message)),
    );
    // Original decision ports are immutable even when instructions/consumer sources are reviewed.
    for (const old of source.nodes)
      if (old.kind === 'decision') {
        const node = result.data.nodes.find((entry) => entry.id === old.id);
        if (
          node?.kind === 'decision' &&
          JSON.stringify(
            routes(old.config.answer)
              .map((route) => route.id)
              .sort(),
          ) !==
            JSON.stringify(
              decisionRouteDeclarations(node.config)
                .map((route) => route.id)
                .sort(),
            )
        )
          review.issues.push(
            problem(
              'V4_ROUTE_ID_CHANGED',
              '/',
              'reviewed conversion changed original decision route ids',
            ),
          );
      }
  }
  review.finish();
  return review.issues.length || !result.success
    ? { ok: false, issues: review.issues, reviewItems: review.items }
    : {
        ok: true,
        value: result.data,
        reviewItems: review.items,
        ready: review.items.every((item) => item.status !== 'pending'),
      };
}
