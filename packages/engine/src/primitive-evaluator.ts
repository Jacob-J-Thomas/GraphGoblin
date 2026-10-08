import {
  PrimitiveAnswerSchema,
  type Evaluation,
  type EvaluationAnswerSpec,
  type EvaluationProvenance,
  type JsonValue,
  type PrimitiveAnswer,
} from '@graphgoblin/contracts';
import { evaluateExpression, validatePrimitiveAnswer } from '@graphgoblin/domain';
import { summarizeDeciderError } from './decider-errors.js';
import { isAbortError, RunFailureError } from './errors.js';
import type { HandlerServices } from './handler.js';
import type { ClassifierUnavailableReason, EnginePorts } from './ports.js';

/** Callers retain their own question rendering and provider-state shape. */
export interface PrimitiveEvaluationRequest {
  nodeId: string;
  ownerId: string;
  evaluation: Evaluation;
  answer: EvaluationAnswerSpec;
  expressionView: unknown;
  question?: string;
  context?: JsonValue;
  signal: AbortSignal;
  ports: Pick<EnginePorts, 'classifiers' | 'deciders' | 'logger'>;
  resolveModel: HandlerServices['resolveModel'];
}

export interface PrimitiveEvaluationResult {
  answer: PrimitiveAnswer;
  provenance: EvaluationProvenance;
  acceptance:
    | { status: 'accepted' }
    | { status: 'rejected'; code: 'EVALUATION_RESULT_REJECTED'; minConfidence: number };
}

const CLASSIFIER_MESSAGES: Record<ClassifierUnavailableReason, string> = {
  CLASSIFIER_MODEL_NOT_FOUND: 'The selected classifier is not in the catalog',
  CLASSIFIER_PRIMITIVE_UNSUPPORTED: 'The selected classifier does not support this primitive',
  CLASSIFIER_MODEL_DISABLED: 'The selected classifier is disabled',
  CLASSIFIER_SECRET_MISSING: 'The classifier key is not configured',
  CLASSIFIER_SECRET_UNREADABLE: 'The classifier key cannot be read',
};

function fail(
  request: PrimitiveEvaluationRequest,
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

function providerFailure(request: PrimitiveEvaluationRequest, error: unknown): never {
  if (isAbortError(error) || request.signal.aborted) throw error;
  const diagnostic = summarizeDeciderError(error);
  request.ports.logger.warn(
    {
      nodeId: request.nodeId,
      kind: request.evaluation.kind,
      name: diagnostic.name,
      code: diagnostic.code,
      status: diagnostic.status,
    },
    'evaluation provider failed',
  );
  if (diagnostic.code === 'DECIDER_INVALID_RESPONSE')
    fail(request, 'EVALUATION_INVALID_RESPONSE', diagnostic.message);
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
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      ...(diagnostic.status !== undefined ? { status: diagnostic.status } : {}),
    },
  );
}

function validated(request: PrimitiveEvaluationRequest, value: unknown): PrimitiveAnswer {
  const parsed = PrimitiveAnswerSchema.safeParse(value);
  if (!parsed.success)
    fail(
      request,
      'EVALUATION_INVALID_RESPONSE',
      'The evaluator returned an invalid primitive answer',
    );
  const problem = validatePrimitiveAnswer(request.answer, parsed.data);
  if (problem) fail(request, 'EVALUATION_INVALID_RESPONSE', problem);
  return parsed.data;
}

/** One evaluator invocation; only a valid classifier confidence result may be rejected. */
export async function evaluatePrimitive(
  request: PrimitiveEvaluationRequest,
): Promise<PrimitiveEvaluationResult> {
  const { evaluation, answer } = request;
  let result: PrimitiveAnswer;
  let provenance: EvaluationProvenance;
  if (evaluation.kind === 'expression') {
    if (answer.type === 'score')
      fail(request, 'EVALUATION_INVALID_CONFIGURATION', 'Score requires a classifier evaluator');
    let value: unknown;
    try {
      value = await evaluateExpression(evaluation.jsonata, request.expressionView);
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) throw error;
      fail(
        request,
        'EVALUATION_EXPRESSION_FAILED',
        'The evaluation expression could not be evaluated',
      );
    }
    if (answer.type === 'choice') {
      if (typeof value !== 'string' || !answer.options.some((option) => option.id === value))
        fail(
          request,
          'EVALUATION_INVALID_RESPONSE',
          'The decision expression must return a declared string option id',
        );
      result = { type: 'choice', optionId: value, confidence: null, probabilities: null };
    } else {
      if (typeof value !== 'boolean')
        fail(request, 'EVALUATION_INVALID_RESPONSE', 'The Noul expression must return a boolean');
      result = { type: 'noul', kind: 'expression', holds: value, confidence: null };
    }
    provenance = {
      kind: 'expression',
      provider: null,
      classifierId: null,
      model: null,
      effort: null,
    };
  } else {
    if (request.question === undefined || request.context === undefined)
      fail(
        request,
        'EVALUATION_INVALID_CONFIGURATION',
        'Provider evaluation needs prepared question and state',
      );
    const prepared = { question: request.question, context: request.context };
    if (evaluation.kind === 'classifier') {
      const selection = await request.ports.classifiers.resolve(
        request.ownerId,
        evaluation.model,
        answer.type,
      );
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
      try {
        if (answer.type === 'choice') {
          result = await selection.classifier.choose(
            { ...prepared, options: answer.options },
            request.signal,
          );
        } else if (answer.type === 'noul') {
          const raw: unknown = await selection.classifier.classifyNoul(
            { ...prepared, criteria: { true: answer.true.criteria, false: answer.false.criteria } },
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
            );
          const holds = raw.trueProbability >= (evaluation.truthThreshold ?? 0.5);
          result = {
            type: 'noul',
            kind: 'classifier',
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
        providerFailure(request, error);
      }
      result = validated(request, result);
      if (result.type === 'choice' && (result.confidence === null || result.probabilities === null))
        fail(
          request,
          'EVALUATION_INVALID_RESPONSE',
          'The classifier must return confidence and option probabilities',
        );
      if (result.type === 'noul' && result.kind !== 'classifier')
        fail(
          request,
          'EVALUATION_INVALID_RESPONSE',
          'The classifier must return its true probability',
        );
      provenance = { kind: 'classifier', ...selection.provenance, effort: null };
      if (evaluation.minConfidence !== undefined) {
        if (result.confidence === null)
          fail(
            request,
            'EVALUATION_INVALID_RESPONSE',
            'The classifier must return confidence for the authored minimum',
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
    } else {
      if (answer.type === 'score')
        fail(request, 'EVALUATION_INVALID_CONFIGURATION', 'Score requires a classifier evaluator');
      const decider = request.ports.deciders.find(
        (port) => port.id === evaluation.harness && port.available(),
      );
      if (!decider)
        fail(request, 'EVALUATION_UNAVAILABLE', 'The selected LLM evaluator is unavailable', true);
      if (answer.type === 'noul' && !decider.noul)
        fail(
          request,
          'EVALUATION_INVALID_CONFIGURATION',
          'The selected LLM evaluator does not support Noul',
        );
      const resolved = await request.resolveModel(
        evaluation.harness,
        evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
        evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
      );
      try {
        if (answer.type === 'choice') {
          result = await decider.choose(
            { ...prepared, options: answer.options, ...resolved },
            request.signal,
          );
        } else {
          const raw = await decider.noul!(
            {
              ...prepared,
              criteria: { true: answer.true.criteria, false: answer.false.criteria },
              ...resolved,
            },
            request.signal,
          );
          result = { ...raw, kind: 'llm' };
        }
      } catch (error) {
        providerFailure(request, error);
      }
      result = validated(request, result);
      if (
        result.confidence === null ||
        (result.type === 'choice' && result.probabilities !== null) ||
        (result.type === 'noul' && result.kind !== 'llm')
      )
        fail(
          request,
          'EVALUATION_INVALID_RESPONSE',
          'LLM answers require informational confidence without classifier probabilities',
        );
      provenance = { kind: 'llm', provider: evaluation.harness, classifierId: null, ...resolved };
    }
  }
  return { answer: result, provenance, acceptance: { status: 'accepted' } };
}
