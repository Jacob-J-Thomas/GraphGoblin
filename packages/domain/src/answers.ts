import {
  PrimitiveAnswerSchema,
  type DecisionAnswer,
  type EvaluationAnswerSpec,
  type PrimitiveAnswer,
} from '@graphgoblin/contracts';
import { DomainError } from './errors.js';

/** Stable authored route IDs, independent of labels or numeric score values. */
export function answerPortIds(answer: DecisionAnswer): string[] {
  switch (answer.type) {
    case 'choice':
      return answer.options.map((option) => option.id);
    case 'noul':
      return [answer.true.id, answer.false.id];
    case 'score':
      return answer.bands.map((band) => band.id);
  }
}

/** Validate raw facts against the submitted primitive, without confidence acceptance policy. */
export function validatePrimitiveAnswer(
  spec: EvaluationAnswerSpec,
  result: PrimitiveAnswer,
): string | null {
  if (!PrimitiveAnswerSchema.safeParse(result).success)
    return 'The evaluator returned a malformed primitive answer';
  if (spec.type !== result.type) return 'The evaluator returned a different answer primitive';
  if (spec.type === 'choice' && result.type === 'choice') {
    const ids = new Set(spec.options.map((option) => option.id));
    if (!ids.has(result.optionId)) return 'The evaluator did not select a declared option id';
    if (result.probabilities !== null) {
      const keys = Object.keys(result.probabilities);
      if (keys.length !== ids.size || keys.some((key) => !ids.has(key)))
        return 'Classifier probabilities must cover exactly the declared option ids';
    }
  }
  if (result.type === 'noul' && result.kind === 'classifier') {
    const confidence = result.holds ? result.trueProbability : 1 - result.trueProbability;
    if (result.confidence !== confidence)
      return 'Noul confidence must describe the selected boolean side';
  }
  if (spec.type === 'score' && result.type === 'score') {
    if (result.score > spec.anchors.length - 1) return 'The score is outside the submitted rubric';
    const keys = spec.anchors.map((_, index) => String(index));
    if (
      Object.keys(result.legend).length !== keys.length ||
      keys.some((key, index) => result.legend[key] !== spec.anchors[index])
    )
      return 'The score legend must match exactly the submitted rubric';
    if (
      result.probabilities !== null &&
      (Object.keys(result.probabilities).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(result.probabilities!, key)))
    )
      return 'Score probabilities must cover exactly the submitted rubric indices';
  }
  return null;
}

/** Map a valid answer onto its declared route without rounding or display-order dependence. */
export function decisionPortId(spec: DecisionAnswer, result: PrimitiveAnswer): string {
  const invalid = validatePrimitiveAnswer(spec, result);
  if (invalid !== null) throw new DomainError('EVALUATION_INVALID_RESPONSE', invalid);
  if (spec.type === 'choice' && result.type === 'choice') return result.optionId;
  if (spec.type === 'noul' && result.type === 'noul')
    return result.holds ? spec.true.id : spec.false.id;
  if (spec.type === 'score' && result.type === 'score') {
    const endpoint = spec.anchors.length - 1;
    const band = spec.bands.find(
      (candidate) =>
        result.score >= candidate.min &&
        (result.score < candidate.max || (candidate.max === endpoint && result.score === endpoint)),
    );
    if (band) return band.id;
  }
  throw new DomainError(
    'EVALUATION_INVALID_CONFIGURATION',
    'The answer has no declared output port',
  );
}
