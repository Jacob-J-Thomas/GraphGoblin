import type { HarnessId } from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessPort, HarnessResult } from '../ports.js';
import { FakeHarness } from './fakes.js';
import { singleNodeLoop } from './scenario.js';

/** Public-port fixtures shared by the handler and HTTP provenance boundary matrices. */
export const failureCases = [
  { code: 'HARNESS_TERMINATION_UNCONFIRMED', state: 'delivery-uncertain', eligible: false },
  { code: 'HARNESS_SESSION_MISSING', state: 'session-missing', eligible: false },
  { code: 'HARNESS_ARGUMENTS_REJECTED', state: 'definitely-not-submitted', eligible: false },
  { code: 'HARNESS_INVALID_CONFIGURATION', state: 'definitely-not-submitted', eligible: false },
  { code: 'HARNESS_UNSUPPORTED_POLICY', state: 'definitely-not-submitted', eligible: false },
  { code: 'HARNESS_TRANSPORT_FAILED', state: 'definitely-not-submitted', eligible: true },
  { code: 'HARNESS_NOT_AUTHENTICATED', state: 'definitely-not-submitted', eligible: true },
  { code: 'HARNESS_QUOTA_EXHAUSTED', state: 'delivery-uncertain', eligible: true },
  { code: 'HARNESS_TIMEOUT', state: 'delivery-uncertain', eligible: true },
  { code: 'HARNESS_NOT_INSTALLED', state: 'definitely-not-submitted', eligible: true },
  { code: 'HARNESS_TRANSPORT_FAILED', state: 'delivery-uncertain', eligible: true },
  { code: 'HARNESS_TURN_FAILED', state: 'delivery-uncertain', eligible: true },
] as const;
export type FailureCase = (typeof failureCases)[number];
export const failureSources = [
  'launch',
  'event',
  'iterator',
  'result',
  'cleanup',
  'cancel',
] as const;
export type FailureSource = (typeof failureSources)[number];
export const recordingModes = ['ok', 'before', 'after'] as const;

export function failureLoop(family: HarnessId) {
  return singleNodeLoop('Failure evidence matrix', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: {
      harness: family,
      model: family === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
      effort: 'low',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template: 'Original task' },
      output: {
        schema: {
          jsonSchema: { type: 'number' },
          repair: {
            enabled: true,
            maxAttempts: 1,
            prompt: 'Repair exactly: {{ value }}',
          },
        },
      },
    },
  });
}

export function failureHarness(
  family: HarnessId,
  spec: FailureCase,
  source: FailureSource,
  retriable: boolean,
) {
  const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
  const calls: string[] = [];
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const error = () =>
    Object.assign(new Error('Selected ' + spec.code), {
      code: spec.code,
      retriable,
      ...(spec.state === 'definitely-not-submitted' ? { submission: spec.state } : {}),
    });
  const port: HarnessPort = {
    id: family,
    preflight: () => fake.preflight(),
    start(request, signal) {
      calls.push(request.turn.prompt);
      return fake.start(request, signal);
    },
    resume(id, request, signal) {
      calls.push(request.turn.prompt);
      if (calls.length > 2) return fake.resume(id, request, signal);
      if (source === 'launch') throw error();
      let reject!: (error: Error) => void;
      const result = new Promise<HarnessResult>((_resolve, rejected) => {
        reject = rejected;
      });
      void result.catch(() => undefined);
      return {
        sessionId: Promise.resolve(id),
        result,
        events: (async function* (): AsyncGenerator<HarnessEvent> {
          // This lower-ranked refusal used to hide later pinned and terminal evidence.
          if (spec.code.includes('UNCONFIRMED') || spec.code.includes('MISSING') || !spec.eligible)
            yield {
              type: 'error',
              code: 'HARNESS_NOT_AUTHENTICATED',
              message: 'Earlier auth',
              retriable: true,
              submission: 'definitely-not-submitted',
            };
          if (source === 'event')
            yield { type: 'error', ...error(), message: error().message, submission: spec.state };
          entered();
          if (source === 'cancel')
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
          const failure = source === 'cleanup' ? new Error('Generic final wrapper') : error();
          reject(failure);
          if (source === 'iterator') throw failure;
        })(),
        cancel: () => (source === 'cleanup' ? Promise.reject(error()) : Promise.resolve()),
      };
    },
  };
  return { port, fake, calls, ready };
}

export function expectedFailure(
  spec: FailureCase,
  source: FailureSource,
  family: HarnessId,
  retriable: boolean,
) {
  const cancelled = source === 'cancel' && spec.code !== 'HARNESS_TERMINATION_UNCONFIRMED';
  const state =
    source === 'launch' &&
    spec.state === 'delivery-uncertain' &&
    spec.code !== 'HARNESS_TERMINATION_UNCONFIRMED'
      ? 'definitely-not-submitted'
      : spec.state;
  const code =
    spec.code === 'HARNESS_TIMEOUT'
      ? 'INFERENCE_TIMEOUT'
      : spec.code === 'HARNESS_TURN_FAILED' ||
          (!spec.eligible && spec.state === 'definitely-not-submitted')
        ? state === 'delivery-uncertain'
          ? 'HARNESS_DELIVERY_UNCERTAIN'
          : 'HARNESS_TURN_FAILED'
        : spec.code;
  const generic = code === 'HARNESS_DELIVERY_UNCERTAIN' || code === 'HARNESS_TURN_FAILED';
  return {
    cancelled,
    code,
    resumable:
      spec.eligible &&
      (spec.code === 'HARNESS_TRANSPORT_FAILED'
        ? retriable
        : !generic || family === 'codex' || retriable),
    state,
  };
}
