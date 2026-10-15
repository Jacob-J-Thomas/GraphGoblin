import { describe, it, expect, vi } from 'vitest';
import {
  ClassifierDecisionConfigSchema,
  type ExpressionDecisionConfig,
  type LlmDecisionConfig,
} from '@graphgoblin/contracts';
import {
  evaluateClassifier,
  evaluateRoute,
  evaluateBoolean,
  type ClassifierEvaluationRequest,
} from './primitive-evaluator.js';
import { createFakePorts } from './testing/index.js';
const sides = {
  type: 'noul',
  true: { id: 'yes', label: 'Ready', criteria: 'Ready' },
  false: { id: 'no', label: 'Fix', criteria: 'Fix' },
};
function request(): ClassifierEvaluationRequest {
  return {
    nodeId: 'evaluate',
    ownerId: 'owner',
    config: ClassifierDecisionConfigSchema.parse({
      kind: 'classifier',
      model: 'jev',
      question: 'Unused',
      answer: sides,
    }),
    question: 'Prepared question',
    context: { suppliedState: true },
    signal: new AbortController().signal,
    ports: createFakePorts(),
    resolveModel: vi.fn(() => Promise.resolve({ model: 'gpt-6-luna', effort: 'low' as const })),
  };
}
const routes = [
  { id: 'yes', label: 'Ready' },
  { id: 'no', label: 'Fix' },
];
const llm: LlmDecisionConfig = {
  kind: 'llm',
  instructions: 'Choose',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  routes,
  context: { messages: 'last', includeLastOutput: true },
};
describe('separate typed evaluation operations', () => {
  it.each(['choice', 'score'] as const)(
    'rejects Noul thresholds on %s before provider resolution',
    async (type) => {
      const input = request();
      input.config = {
        ...input.config,
        truthThreshold: 0.8,
        answer:
          type === 'score'
            ? { type, anchors: ['Low', 'High'] }
            : {
                type,
                options: [
                  { id: 'yes', label: 'Yes', criteria: 'Ready' },
                  { id: 'no', label: 'No', criteria: 'Fix' },
                ],
              },
      };
      await expect(evaluateClassifier(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
        options: { resumable: false },
      });
      expect(input.resolveModel).not.toHaveBeenCalled();
    },
  );
  it.each([null, undefined, {}, [], { type: 'noul', trueProbability: '0.5' }])(
    'rejects malformed Noul response %j',
    async (raw) => {
      const input = request();
      const ports = createFakePorts();
      Object.defineProperty(ports.jev, 'classifyNoul', { value: () => Promise.resolve(raw) });
      input.ports = ports;
      await expect(evaluateClassifier(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_RESPONSE',
      });
    },
  );
  it.each(['missing', '"unknown"', 'true', '1', 'null', '[]', '{}', '["yes","no"]'])(
    'rejects invalid scalar route result %s',
    async (jsonata) => {
      const input = request();
      const config: ExpressionDecisionConfig = { kind: 'expression', jsonata, routes };
      await expect(evaluateRoute({ ...input, config, expressionView: {} })).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_RESPONSE',
        options: { resumable: false },
      });
    },
  );
  it('keeps expression errors typed and cancellation unchanged', async () => {
    const input = request();
    await expect(
      evaluateRoute({
        ...input,
        config: { kind: 'expression', jsonata: '(', routes },
        expressionView: {},
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_EXPRESSION_FAILED' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      evaluateRoute({
        ...input,
        signal: controller.signal,
        config: { kind: 'expression', jsonata: '"yes"', routes },
        expressionView: {},
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('evaluates strict booleans independently of decision route ports', async () => {
    const input = request();
    expect(
      await evaluateBoolean({
        ...input,
        config: { kind: 'expression', jsonata: 'false' },
        expressionView: {},
      }),
    ).toMatchObject({ observation: { kind: 'boolean', holds: false } });
    await expect(
      evaluateBoolean({
        ...input,
        config: { kind: 'expression', jsonata: 'missing' },
        expressionView: {},
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE' });
  });
  it.each([
    { route: 'unknown', confidence: 0.5, reasoning: 'R' },
    ...[NaN, Infinity, -0.1, 1.1, null].map((confidence) => ({
      route: 'yes',
      confidence,
      reasoning: 'R',
    })),
    { route: 'yes', confidence: 0.5, reasoning: 'R', extra: true },
    null,
  ])('validates raw LLM route response %# independently of adapter', async (raw) => {
    const input = request(),
      ports = createFakePorts();
    Object.defineProperty(ports.codexDecider, 'route', { value: () => Promise.resolve(raw) });
    await expect(
      evaluateRoute({
        ...input,
        ports,
        config: llm,
        instructions: 'Rendered',
        context: { prepared: true },
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE' });
  });
  it('preserves route instructions and informational zero confidence, truncating reasoning', async () => {
    const input = request(),
      ports = createFakePorts();
    ports.codexDecider.route = vi.fn(() =>
      Promise.resolve({ route: 'no', confidence: 0, reasoning: 'r'.repeat(3000) }),
    );
    const result = await evaluateRoute({
      ...input,
      ports,
      config: llm,
      instructions: 'Rendered instructions',
      context: { prepared: true },
    });
    expect(result.observation).toMatchObject({
      kind: 'route',
      routeId: 'no',
      confidence: 0,
      reasoning: 'r'.repeat(2048),
    });
    expect(ports.codexDecider.route).toHaveBeenCalledWith(
      {
        instructions: 'Rendered instructions',
        routes,
        context: { prepared: true },
        model: 'gpt-6-luna',
        effort: 'low',
      },
      input.signal,
    );
  });
  it('checks malformed boolean responses and has no fallback', async () => {
    const input = request(),
      ports = createFakePorts();
    Object.defineProperty(ports.codexDecider, 'evaluateBoolean', {
      value: () => Promise.resolve({ holds: 'true', confidence: 1, reasoning: 'R' }),
    });
    const { routes: _routes, context: _context, ...config } = llm;
    await expect(
      evaluateBoolean({ ...input, ports, config, instructions: 'Ready?', context: null }),
    ).rejects.toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE' });
    expect(ports.classifiers.requests).toEqual([]);
  });
  it('honors cancellation during registry and model resolution before provider calls', async () => {
    const input = request(),
      ports = createFakePorts(),
      registryAbort = new AbortController();
    vi.spyOn(ports.classifiers, 'resolve').mockImplementation(() => {
      registryAbort.abort();
      return Promise.resolve({
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_NOT_FOUND',
        message: 'Unavailable',
      });
    });
    await expect(
      evaluateClassifier({ ...input, ports, signal: registryAbort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const modelAbort = new AbortController();
    await expect(
      evaluateRoute({
        ...input,
        ports,
        signal: modelAbort.signal,
        config: llm,
        instructions: 'Choose',
        context: null,
        resolveModel: () => {
          modelAbort.abort();
          return Promise.resolve({ model: 'gpt-6-luna', effort: 'low' });
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(ports.codexDecider.routes).toEqual([]);
  });
});
