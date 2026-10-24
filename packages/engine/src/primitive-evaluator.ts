import {
  ClassifierAnswerEmissionSchema,
  EvaluationEmissionSchema,
  type ClassifierBinding,
  type ClassifierDecisionConfig,
  type ExpressionDecisionConfig,
  type LlmDecisionConfig,
  type ClassifierEvaluation,
  type EvaluationProvenance,
  type JsonValue,
  type ClassifierAnswer,
  type EvaluationObservation,
} from '@graphgoblin/contracts';
import { evaluateExpression, validatePrimitiveAnswer } from '@graphgoblin/domain';
import { summarizeDeciderError } from './decider-errors.js';
import { completeWithDeadline } from './completion-deadline.js';
import { isAbortError, RunFailureError } from './errors.js';
import type { HandlerServices } from './handler.js';
import type { ClassifierUnavailableReason, EnginePorts } from './ports.js';
interface EvaluationRequest {
  structuredTimeoutMs?: number | null;
  runId?: string;
  nodeId: string;
  ownerId: string;
  config: { kind: 'expression' | 'llm' | 'classifier' };
  signal: AbortSignal;
  ports: Pick<EnginePorts, 'classifiers' | 'deciders' | 'logger'>;
  resolveModel: HandlerServices['resolveModel'];
}
export interface ClassifierEvaluationRequest extends EvaluationRequest {
  config: ClassifierDecisionConfig;
  question: string;
  context: JsonValue;
  /** The run's pinned binding for `config.model` (ADR-0041); absent when it had none at start. */
  binding: ClassifierBinding | undefined;
}
export type RouteEvaluationRequest = EvaluationRequest &
  (
    | { config: ExpressionDecisionConfig; expressionView: unknown }
    | { config: LlmDecisionConfig; instructions: string; context: JsonValue }
  );
const CLASSIFIER_MESSAGES: Record<ClassifierUnavailableReason, string> = {
  CLASSIFIER_MODEL_NOT_FOUND: 'The selected classifier is not in the catalog',
  CLASSIFIER_PRIMITIVE_UNSUPPORTED: 'The selected classifier does not support this primitive',
  CLASSIFIER_MODEL_DISABLED: 'The selected classifier is disabled',
  CLASSIFIER_SECRET_MISSING: 'The classifier key is not configured',
  CLASSIFIER_SECRET_UNREADABLE: 'The classifier key cannot be read',
};

function fail(
  request: EvaluationRequest,
  code: ConstructorParameters<typeof RunFailureError>[0],
  message: string,
  resumable = false,
  details?: unknown,
): never {
  throw new RunFailureError(code, message, {
    nodeId: request.nodeId,
    resumable,
    ...(details !== undefined ? { details } : {}),
  });
}

function providerFailure(
  request: EvaluationRequest,
  error: unknown,
  provenance: EvaluationProvenance,
): never {
  if (isAbortError(error) || request.signal.aborted) throw error;
  const diagnostic = summarizeDeciderError(error);
  request.ports.logger.warn(
    {
      nodeId: request.nodeId,
      kind: request.config.kind,
      name: diagnostic.name,
      code: diagnostic.code,
      status: diagnostic.status,
    },
    'evaluation provider failed',
  );
  if (diagnostic.code === 'DECIDER_INVALID_RESPONSE')
    fail(request, 'EVALUATION_INVALID_RESPONSE', diagnostic.message, false, { provenance });
  const resumable =
    diagnostic.code === 'DECIDER_UNAVAILABLE' ||
    diagnostic.code === 'DECIDER_NOT_AUTHENTICATED' ||
    diagnostic.code === 'DECIDER_RATE_LIMITED' ||
    diagnostic.code === 'DECIDER_UNREACHABLE' ||
    diagnostic.code === 'DECIDER_TIMEOUT' ||
    (diagnostic.status !== undefined && diagnostic.status >= 500);
  fail(
    request,
    diagnostic.code === 'DECIDER_UNAVAILABLE'
      ? 'EVALUATION_UNAVAILABLE'
      : 'EVALUATION_PROVIDER_FAILED',
    diagnostic.message,
    resumable,
    {
      provenance,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      ...(diagnostic.status !== undefined ? { status: diagnostic.status } : {}),
    },
  );
}

function validated(
  request: ClassifierEvaluationRequest,
  value: unknown,
  provenance: EvaluationProvenance,
): ClassifierAnswer {
  const parsed = ClassifierAnswerEmissionSchema.safeParse(value);
  if (!parsed.success)
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The evaluator returned an invalid primitive answer',
      false,
      { provenance },
    );
  const problem = validatePrimitiveAnswer(request.config.answer, parsed.data);
  if (problem) fail(request, 'EVALUATION_INVALID_RESPONSE', problem, false, { provenance });
  return parsed.data;
}

export async function evaluateClassifier(
  request: ClassifierEvaluationRequest,
): Promise<ClassifierEvaluation> {
  request.signal.throwIfAborted();
  const evaluation = request.config,
    answer = evaluation.answer;
  if (evaluation.truthThreshold !== undefined && answer.type !== 'noul')
    fail(
      request,
      'EVALUATION_INVALID_CONFIGURATION',
      'truthThreshold applies only to classifier Noul',
    );
  const prepared = { question: request.question, context: request.context };
  const criteria =
    answer.type === 'noul'
      ? { true: answer.true.criteria, false: answer.false.criteria }
      : undefined;
  let result: ClassifierAnswer;
  // The run calls what it pinned at start; a classifier missing then is never looked up again, so
  // no later catalog edit reaches this run and a resume cannot help.
  if (!request.binding)
    fail(
      request,
      'EVALUATION_UNAVAILABLE',
      `${CLASSIFIER_MESSAGES.CLASSIFIER_MODEL_NOT_FOUND} when this run started; start a new run`,
      false,
      { reason: 'CLASSIFIER_MODEL_NOT_FOUND' },
    );
  const selection = await request.ports.classifiers.resolve(
    request.ownerId,
    evaluation.model,
    answer.type,
    request.binding,
  );
  request.signal.throwIfAborted();
  if (selection.status === 'unavailable') {
    const invalid = selection.reason === 'CLASSIFIER_PRIMITIVE_UNSUPPORTED';
    fail(
      request,
      invalid ? 'EVALUATION_INVALID_CONFIGURATION' : 'EVALUATION_UNAVAILABLE',
      CLASSIFIER_MESSAGES[selection.reason],
      !invalid,
      { reason: selection.reason },
    );
  }
  const provenance = {
    kind: 'classifier' as const,
    ...selection.provenance,
    effort: null,
  };
  try {
    if (answer.type === 'choice') {
      result = await selection.classifier.choose(
        { ...prepared, options: answer.options },
        request.signal,
      );
    } else if (answer.type === 'noul') {
      const raw: unknown = await selection.classifier.classifyNoul(
        { ...prepared, criteria: criteria! },
        request.signal,
      );
      if (
        typeof raw !== 'object' ||
        raw === null ||
        Array.isArray(raw) ||
        !('type' in raw) ||
        raw.type !== 'noul' ||
        !('trueProbability' in raw) ||
        typeof raw.trueProbability !== 'number' ||
        !Number.isFinite(raw.trueProbability) ||
        raw.trueProbability < 0 ||
        raw.trueProbability > 1
      )
        fail(
          request,
          'EVALUATION_INVALID_RESPONSE',
          'The classifier returned an invalid Noul probability',
          false,
          { provenance },
        );
      const holds = raw.trueProbability >= (evaluation.truthThreshold ?? 0.5);
      result = {
        type: 'noul',
        holds,
        trueProbability: raw.trueProbability,
        confidence: holds ? raw.trueProbability : 1 - raw.trueProbability,
      };
    } else {
      result = await selection.classifier.score(
        { ...prepared, anchors: answer.anchors },
        request.signal,
      );
    }
  } catch (error) {
    if (error instanceof RunFailureError) throw error;
    providerFailure(request, error, provenance);
  }
  result = validated(request, result, provenance);
  if (result.type === 'choice' && (result.confidence === null || result.probabilities === null))
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The classifier must return confidence and option probabilities',
      false,
      { provenance },
    );
  if (result.type === 'noul' && result.trueProbability === null)
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The classifier must return its true probability',
      false,
      { provenance },
    );
  if (evaluation.minConfidence !== undefined) {
    if (result.confidence === null)
      fail(
        request,
        'EVALUATION_INVALID_RESPONSE',
        'The classifier must return confidence for the authored minimum',
        false,
        { provenance },
      );
    if (result.confidence < evaluation.minConfidence)
      return {
        answer: result,
        provenance,
        acceptance: {
          status: 'rejected',
          code: 'EVALUATION_RESULT_REJECTED',
          minConfidence: evaluation.minConfidence,
        },
      };
  }
  request.signal.throwIfAborted();
  return { answer: result, provenance, acceptance: { status: 'accepted' } };
}

const expressionProvenance: EvaluationProvenance = {
  kind: 'expression',
  provider: null,
  classifierId: null,
  model: null,
  effort: null,
};
async function expressionValue(
  request: EvaluationRequest,
  source: string,
  view: unknown,
): Promise<unknown> {
  request.signal.throwIfAborted();
  try {
    const value: unknown = await evaluateExpression(source, view);
    request.signal.throwIfAborted();
    return value;
  } catch (error) {
    if (isAbortError(error) || request.signal.aborted) throw error;
    fail(
      request,
      'EVALUATION_EXPRESSION_FAILED',
      'The evaluation expression could not be evaluated',
    );
  }
}
async function evaluateLlm(
  request: EvaluationRequest,
  config: LlmDecisionConfig,
  instructions: string,
  context: JsonValue,
): Promise<{ provenance: EvaluationProvenance; observation: EvaluationObservation }> {
  request.signal.throwIfAborted();
  const decider = request.ports.deciders.find(
    (port) => port.id === config.harness && port.available(),
  );
  if (!decider)
    fail(request, 'EVALUATION_UNAVAILABLE', 'The selected LLM evaluator is unavailable', true);
  const resolved = await request.resolveModel(
    config.harness,
    config.model.mode === 'explicit' ? config.model.value : undefined,
    config.effort.mode === 'explicit' ? config.effort.value : undefined,
  );
  request.signal.throwIfAborted();
  const provenance: EvaluationProvenance = {
    kind: 'llm',
    provider: config.harness,
    classifierId: null,
    ...resolved,
  };
  let raw: unknown;
  try {
    const prepared = { instructions, context, ...resolved };
    raw = await completeWithDeadline(
      (signal) => decider.route({ ...prepared, routes: config.routes }, signal),
      request.signal,
      request.structuredTimeoutMs ?? null,
      request.ports.logger,
      { nodeId: request.nodeId, ...(request.runId ? { runId: request.runId } : {}) },
    );
    request.signal.throwIfAborted();
  } catch (error) {
    if (error instanceof RunFailureError) throw error;
    providerFailure(request, error, provenance);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The LLM returned an invalid structured answer',
      false,
      { provenance },
    );
  const keys = ['route', 'confidence', 'reasoning'];
  if (
    Object.keys(raw).length !== 3 ||
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    !('confidence' in raw) ||
    typeof raw.confidence !== 'number' ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1 ||
    !('reasoning' in raw) ||
    typeof raw.reasoning !== 'string'
  )
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The LLM returned an invalid structured answer',
      false,
      { provenance },
    );
  const observation: EvaluationObservation = (() => {
    if (
      !('route' in raw) ||
      typeof raw.route !== 'string' ||
      !config.routes.some((route) => route.id === raw.route)
    )
      fail(
        request,
        'EVALUATION_INVALID_RESPONSE',
        'The LLM must return a declared route id',
        false,
        { provenance },
      );
    return {
      kind: 'route' as const,
      routeId: raw.route,
      confidence: raw.confidence,
      reasoning: raw.reasoning.slice(0, 2048),
    };
  })();
  const emission = EvaluationEmissionSchema.safeParse({ provenance, observation });
  if (!emission.success)
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The LLM returned inconsistent evaluation evidence',
      false,
      { provenance, issues: emission.error.issues },
    );
  return emission.data;
}
export async function evaluateRoute(request: RouteEvaluationRequest) {
  if ('expressionView' in request) {
    const value = await expressionValue(request, request.config.jsonata, request.expressionView);
    if (typeof value !== 'string' || !request.config.routes.some((route) => route.id === value))
      fail(
        request,
        'EVALUATION_INVALID_RESPONSE',
        'The decision expression must return a declared scalar string route id',
      );
    return {
      provenance: expressionProvenance,
      observation: { kind: 'route' as const, routeId: value, confidence: null, reasoning: null },
    };
  }
  return evaluateLlm(request, request.config, request.instructions, request.context);
}
