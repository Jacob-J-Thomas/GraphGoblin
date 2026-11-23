import type { MutationOperation } from '@graphgoblin/contracts';
import {
  observeExpression,
  observePredicate,
  observeTemplate,
  type ExpressionOptions,
  type ExpressionObservation,
  type ExpressionReason,
  type MutationFact,
  type TemplateFact,
} from '@graphgoblin/domain';
import { RunFailureError } from './errors.js';
import { boundedAuthoredCause } from './failure-publication.js';
import type { WorkingDirectoryResult } from './handler.js';

const fields = {
  'script.args': 'Script argument',
  'heartbeat.probe.headers': 'Heartbeat probe header',
  'heartbeat.probe.url': 'Heartbeat probe URL',
  'heartbeat.probe.body': 'Heartbeat probe body',
  'heartbeat.probe.args': 'Heartbeat probe argument',
  'heartbeat.until': 'Heartbeat until predicate',
  'heartbeat.deadline': 'Heartbeat deadline',
  'subloop.input.messages.where': 'Subloop input message selector',
  'subloop.input.artifacts.where': 'Subloop input artifact selector',
  'subloop.input.vars': 'Subloop input variable mapping',
  'subloop.input.inject.content': 'Subloop injected message',
  'subloop.input.trigger.payload': 'Subloop trigger payload expression',
  'subloop.output.custom.patch': 'Subloop output patch expression',
  'subloop.output.vars': 'Subloop output variable mapping',
  'subloop.output.messages.where': 'Subloop output message selector',
  'subloop.output.artifacts.where': 'Subloop output artifact selector',
  'inference.input': 'Inference input transform',
  'inference.contextFiles.template': 'Inference context file template',
  'inference.prompt.template': 'Inference prompt template',
  'inference.output.schema.repair.prompt': 'Inference schema repair prompt',
  'inference.output.transforms': 'Inference output transform',
  'decision.instructions': 'Decision instructions',
  'decision.question': 'Decision question',
  'decision.context.messages.where': 'Decision context message selector',
  'wait.prompt': 'Wait input prompt',
  'wait.timestamp': 'Wait timestamp',
  'settings.workingDirectory.template': 'Working directory template',
} as const;

export interface AuthoredSite {
  nodeId: string | undefined;
  boundary: keyof typeof fields;
  argumentIndex?: number;
  headerIndex?: number;
  itemIndex?: number;
  mapIndex?: number;
  messageIndex?: number;
  fileIndex?: number;
  operationIndex?: number;
  operationKind?: MutationOperation['op'];
  beat?: number;
  attempt?: number;
}

type Reason = MutationFact | { kind: 'timestamp' | 'empty-path' | 'patch-shape' | 'patch-region' };

const expressionCopy: Record<ExpressionReason, string> = {
  compile: 'The expression could not be parsed. Check its JSONata syntax.',
  'unsafe-regex': 'The expression uses an unsafe regular expression. Simplify the pattern.',
  depth: 'The expression exceeded its nesting limit. Reduce its recursion or nesting.',
  time: 'The expression exceeded its time limit. Reduce the work it performs.',
  'evaluation-rejected':
    'The expression could not evaluate this input. Check its input type and mapping.',
};

function causeFor(reason: Reason) {
  switch (reason.kind) {
    case 'expression':
      return { code: 'EXPRESSION_ERROR' as const, message: expressionCopy[reason.reason] };
    case 'template': {
      const { phase, line, column } = reason.fact;
      const position = line === undefined ? '' : ` at line ${line}, column ${column}`;
      const message =
        phase === 'parse'
          ? `The template could not be parsed${position}. Check its Liquid syntax.`
          : `The template could not be rendered${position}. Check its filters and input values.`;
      return { code: 'TEMPLATE_ERROR' as const, message };
    }
    case 'target':
      return {
        code: 'MUTATION_ERROR' as const,
        message: 'The target is invalid. Check its JSON pointer and mutable region.',
      };
    case 'patch':
      return {
        code: 'PATCH_ERROR' as const,
        message: 'The patch could not be applied. Check its target and input shape.',
      };
    case 'regex':
      return {
        code: 'MUTATION_ERROR' as const,
        message: 'The regular expression is invalid or unsafe. Check the pattern and flags.',
      };
    case 'schema':
      return {
        code: 'MUTATION_ERROR' as const,
        message: 'The schema could not be applied. Check the schema and its input.',
      };
    case 'timestamp':
      return {
        code: 'TEMPLATE_ERROR' as const,
        message: 'The value must render to a timestamp. Check the template and date format.',
      };
    case 'empty-path':
      return {
        code: 'TEMPLATE_ERROR' as const,
        message: 'The template rendered to an empty path. Supply a nonempty directory.',
      };
    case 'patch-shape':
      return {
        code: 'EXPRESSION_ERROR' as const,
        message: 'The result is not a JSON patch. Return an array of valid patch operations.',
      };
    case 'patch-region':
      return {
        code: 'EXPRESSION_ERROR' as const,
        message: 'The patch writes outside the mutable regions. Change the patch target.',
      };
  }
}

/** Only concrete evaluator and operation sites construct these closed facts. */
export function authoredFailure(site: AuthoredSite, reason: Reason): RunFailureError {
  const { nodeId, ...details } = site;
  const cause = causeFor(reason);
  cause.message = boundedAuthoredCause(cause.message);
  const index =
    site.argumentIndex ??
    site.headerIndex ??
    site.mapIndex ??
    site.fileIndex ??
    site.messageIndex ??
    site.operationIndex;
  let label: string = fields[site.boundary];
  if (index !== undefined) label += ` ${index + 1}`;
  if (site.operationKind) label += ` (${site.operationKind})`;
  if (site.itemIndex !== undefined) label += `, item ${site.itemIndex + 1}`;
  if (site.attempt !== undefined) label += `, attempt ${site.attempt}`;
  if (site.beat !== undefined) label += `, beat ${site.beat}`;
  const afterResult =
    site.boundary === 'inference.output.schema.repair.prompt' ||
    site.boundary === 'inference.output.transforms';
  const message =
    `${label} failed. ${cause.message}` +
    (afterResult ? ' GraphGoblin received the provider result before this step failed.' : '');
  const code = site.operationKind ? 'MUTATION_ERROR' : cause.code;
  return new RunFailureError(code === 'PATCH_ERROR' ? 'MUTATION_ERROR' : code, message, {
    ...(nodeId === undefined ? {} : { nodeId }),
    resumable: false,
    details: { ...details, cause, ...(afterResult ? { phase: 'after-result' } : {}) },
  });
}

export function transformFailure(
  nodeId: string,
  boundary: 'inference.input' | 'inference.output.transforms',
  fact: MutationFact,
  operationIndex: number,
  operationKind: MutationOperation['op'],
) {
  return authoredFailure(
    {
      nodeId,
      boundary,
      operationIndex,
      operationKind,
      ...('itemIndex' in fact && fact.itemIndex !== undefined ? { itemIndex: fact.itemIndex } : {}),
    },
    fact,
  );
}

export async function renderAuthored(
  site: AuthoredSite,
  template: string,
  view: Record<string, unknown>,
) {
  const result = await observeTemplate(template, view);
  if (!result.ok) throw authoredFailure(site, { kind: 'template', fact: result.fact });
  return result.value;
}

function valueAt<T>(site: AuthoredSite, result: ExpressionObservation<T>): T {
  if (result.ok) return result.value;
  if (!result.reason) throw result.error;
  throw authoredFailure(site, { kind: 'expression', reason: result.reason });
}

/** Call only on the selected pinned field and inert run data. Conversion is the caller's step. */
export async function evaluateAuthored(site: AuthoredSite, expression: string, input: unknown) {
  return valueAt(site, await observeExpression(expression, input));
}

export async function predicateAuthored(
  site: AuthoredSite,
  expression: string,
  input: unknown,
  options?: ExpressionOptions,
) {
  return valueAt(site, await observePredicate(expression, input, options));
}

export function workspaceFailure(nodeId: string | undefined, reason: TemplateFact | 'empty-path') {
  return authoredFailure(
    { nodeId, boundary: 'settings.workingDirectory.template' },
    reason === 'empty-path' ? { kind: reason } : { kind: 'template', fact: reason },
  );
}

export function nodeWorkingDirectory(result: WorkingDirectoryResult, nodeId: string): string {
  if (!result.ok) throw workspaceFailure(nodeId, result.reason);
  return result.directory;
}
