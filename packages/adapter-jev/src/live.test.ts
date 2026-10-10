import type { SecretsPort } from '@graphgoblin/engine';
import { TypeSafeClient, score } from '@typesafe-ai/sdk';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, createJevDecider } from './index.js';

const probability = z.number().min(0).max(1);
const responseSchema = z.object({
  model: z.string().min(1),
  usage: z.object({
    input_tokens: z.number().int().positive(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
const choiceSchema = responseSchema.extend({
  answers: z.object({
    answer: z.object({
      type: z.literal('choice'),
      choice: z.enum(['ship', 'fix', 'drop']),
      confidence: probability,
      probabilities: z.object({ ship: probability, fix: probability, drop: probability }).strict(),
    }),
  }),
});
const noulSchema = responseSchema.extend({
  answers: z.object({ answer: z.object({ type: z.literal('noul'), noul: probability }) }),
});

function documented<T extends z.ZodType>(schema: T, body: unknown, primitive: string): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Report field paths, never the raw body, request headers, or credentials.
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.') || 'response')
      .join(', ');
    throw new Error(`${primitive}: ${fields} deviated from docs/research/jev.md`);
  }
  return parsed.data;
}

// Only response JSON is reported, with credentials removed even if echoed by the service.
function report(primitive: string, observation: unknown, key: string): void {
  console.warn(`[live] ${primitive}`, JSON.stringify(observation).replaceAll(key, '[REDACTED]'));
}

async function safely(key: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Jev live verification failed';
    // eslint-disable-next-line preserve-caught-error -- The original cause may contain credentials.
    throw new Error(message.replaceAll(key, '[REDACTED]'));
  }
}

const classificationSchema = responseSchema.extend({
  answers: z.object({
    answer: z.object({
      type: z.literal('choice'),
      choice: z.enum(['billing', 'bug', 'feature-request', 'account', 'other']),
      confidence: probability,
      probabilities: z
        .object({
          billing: probability,
          bug: probability,
          'feature-request': probability,
          account: probability,
          other: probability,
        })
        .strict(),
    }),
  }),
});

const severityLevels = ['low', 'medium', 'high', 'critical'] as const;
const scoreSchema = responseSchema.extend({
  answers: z.object({
    severity: z.object({
      type: z.literal('score'),
      score: z.number().min(0).max(3),
      confidence: probability,
      legend: z
        .object({
          '0': z.literal('low'),
          '1': z.literal('medium'),
          '2': z.literal('high'),
          '3': z.literal('critical'),
        })
        .strict(),
      probabilities: z
        .object({ '0': probability, '1': probability, '2': probability, '3': probability })
        .strict(),
    }),
  }),
});

it.skipIf(process.env.LIVE !== '1')(
  'verifies Choice and Noul against the TypeSafe API',
  { timeout: 60_000, retry: 0 },
  async ({ skip }) => {
    const key = (process.env.GG_JEV_API_KEY ?? process.env.JEV_API_KEY)?.trim();
    if (!key) {
      return skip(
        'Looked for GG_JEV_API_KEY and JEV_API_KEY; set one in this terminal for LIVE=1 Jev verification',
      );
    }

    try {
      const values: Record<string, string> = { 'jev-api-key': key };
      const secrets: SecretsPort = { resolve: (name) => Promise.resolve(values[name]) };
      const responses: unknown[] = [];
      let calls = 0;
      const decider = createJevDecider({
        secrets,
        // Two requests only: no SDK retries or additional raw-response calls.
        retry: { maxRetries: 0 },
        fetch: async (url, init) => {
          calls += 1;
          if (calls > 2) throw new Error('Jev live verification exceeded its two-call budget');
          const response = await globalThis.fetch(url, init);
          if (response.ok) {
            const body: unknown = await response.clone().json();
            // Validate here so deviations have field names even if the adapter rejects the body.
            if (calls === 1) documented(choiceSchema, body, 'Choice');
            else documented(noulSchema, body, 'Noul');
            responses.push(body);
          }
          return response;
        },
      });
      await decider.init();
      expect(decider.available(), 'Jev decider should be available after init()').toBe(true);

      const options = [
        { id: 'ship', label: 'ship', criteria: 'The change is ready to release' },
        { id: 'fix', label: 'fix', criteria: 'The change needs corrections' },
        { id: 'drop', label: 'drop', criteria: 'The change should be abandoned' },
      ];
      const context = { change: 'Fix a README typo', testsPassed: true, unresolvedIssues: 0 };
      const chosen = await decider.choose(
        { question: 'What should happen next to this change?', options, context },
        new AbortController().signal,
      );
      const rawChoice = documented(choiceSchema, responses[0], 'Choice');
      const answer = rawChoice.answers.answer;
      expect(
        options.some((option) => option.id === chosen.optionId),
        'Choice.label must be a declared route (docs/research/jev.md)',
      ).toBe(true);
      documented(probability, chosen.confidence, 'Choice.confidence');
      expect(chosen.optionId, 'Choice.label must match answers.answer.choice').toBe(answer.choice);
      expect(chosen.confidence, 'Choice.confidence must preserve answers.answer.confidence').toBe(
        answer.confidence,
      );
      expect(chosen.probabilities).toEqual(answer.probabilities);
      expect(Object.keys(chosen.probabilities ?? {}).sort()).toEqual(
        options.map((option) => option.id).sort(),
      );
      report(
        'Choice',
        {
          model: rawChoice.model,
          usage: rawChoice.usage,
          choice: answer.choice,
          confidence: answer.confidence,
          chosenProbability: answer.probabilities[answer.choice],
          response: responses[0],
        },
        key,
      );

      const judged = await decider.classifyNoul(
        {
          question: 'Are all tests passing and all issues resolved so the loop can exit?',
          context,
          criteria: {
            true: 'All tests pass and every issue is resolved',
            false: 'A test fails or an issue remains',
          },
        },
        new AbortController().signal,
      );
      const rawNoul = documented(noulSchema, responses[1], 'Noul');
      const yes = rawNoul.answers.answer.noul;
      documented(probability, judged.trueProbability, 'Noul.trueProbability');
      expect(judged.trueProbability).toBe(yes);
      report(
        'Noul',
        {
          model: rawNoul.model,
          usage: rawNoul.usage,
          noul: yes,
          trueProbability: judged.trueProbability,
          response: responses[1],
        },
        key,
      );
      expect(calls, 'Live verification must make exactly two requests').toBe(2);
    } catch (error) {
      // Discard the original error/cause so SDK or assertion failures cannot expose the key.
      const message = error instanceof Error ? error.message : 'Jev live verification failed';
      // eslint-disable-next-line preserve-caught-error -- The original cause may contain credentials.
      throw new Error(message.replaceAll(key, '[REDACTED]'));
    }
  },
);

it.skipIf(process.env.LIVE !== '1')(
  'classifies a support message with five Choice labels',
  { timeout: 60_000, retry: 0 },
  async ({ skip }) => {
    const key = (process.env.GG_JEV_API_KEY ?? process.env.JEV_API_KEY)?.trim();
    if (!key) return skip('Set GG_JEV_API_KEY or JEV_API_KEY for LIVE=1 Jev verification');

    await safely(key, async () => {
      let body: unknown;
      let calls = 0;
      const decider = createJevDecider({
        secrets: { resolve: () => Promise.resolve(key) },
        retry: { maxRetries: 0 },
        fetch: async (url, init) => {
          calls += 1;
          if (calls > 1) throw new Error('Classification exceeded its one-call budget');
          const response = await globalThis.fetch(url, init);
          if (response.ok) {
            body = await response.clone().json();
            documented(classificationSchema, body, 'Classification');
          }
          return response;
        },
      });
      await decider.init();
      const options = [
        { id: 'billing', label: 'billing', criteria: 'Invoices, payments, charges, or refunds' },
        { id: 'bug', label: 'bug', criteria: 'Broken product functionality or software errors' },
        {
          id: 'feature-request',
          label: 'feature request',
          criteria: 'A request for new product functionality',
        },
        {
          id: 'account',
          label: 'account',
          criteria: 'Login, password, or account access problems',
        },
        { id: 'other', label: 'other', criteria: 'Any message outside these categories' },
      ];
      const chosen = await decider.choose(
        {
          question: 'Classify this support message into exactly one category.',
          options,
          context: {
            message:
              'My credit card was charged twice for invoice INV-123. Please refund the duplicate payment.',
          },
        },
        new AbortController().signal,
      );
      const raw = documented(classificationSchema, body, 'Classification');
      const answer = raw.answers.answer;
      expect(chosen.optionId, 'Classification must choose billing').toBe('billing');
      expect(chosen.optionId, 'Classification must preserve the raw choice').toBe(answer.choice);
      documented(probability, chosen.confidence, 'Classification.confidence');
      expect(chosen.confidence, 'Classification must preserve reported confidence').toBe(
        answer.confidence,
      );
      expect(
        Object.keys(answer.probabilities).sort(),
        'Probabilities must cover all five labels',
      ).toEqual(options.map((option) => option.id).sort());
      expect(chosen.probabilities).toEqual(answer.probabilities);
      report(
        'Classification',
        {
          model: raw.model,
          usage: raw.usage,
          choice: answer.choice,
          confidence: answer.confidence,
          chosenProbability: answer.probabilities[answer.choice],
          response: body,
        },
        key,
      );
      expect(calls, 'Classification must make exactly one request').toBe(1);
    });
  },
);

it.skipIf(process.env.LIVE !== '1')(
  'records the direct SDK Score response for ordered severity levels',
  { timeout: 60_000, retry: 0 },
  async ({ skip }) => {
    const key = (process.env.GG_JEV_API_KEY ?? process.env.JEV_API_KEY)?.trim();
    if (!key) return skip('Set GG_JEV_API_KEY or JEV_API_KEY for LIVE=1 Jev verification');

    await safely(key, async () => {
      let calls = 0;
      const client = new TypeSafeClient({
        apiKey: key,
        baseURL: DEFAULT_BASE_URL,
        defaultModel: DEFAULT_MODEL,
        timeout: 10_000,
        retry: { maxRetries: 0 },
        logLevel: 'off',
        fetch: async (url, init) => {
          calls += 1;
          if (calls > 1) throw new Error('Score exceeded its one-call budget');
          return globalThis.fetch(url, init);
        },
      });
      const body: unknown = await client.systemOne({
        state: {
          incident:
            'The entire production service is down for every customer. All requests fail and there is no workaround.',
        },
        questions: {
          severity: score(
            'Rate the severity of this incident on the ordered levels from low to critical.',
            severityLevels,
          ),
        },
      });
      // Record the complete response even if its shape differs from the SDK declarations.
      report('Score', body, key);
      const raw = documented(scoreSchema, body, 'Score');
      const answer = raw.answers.severity;
      expect(answer.score, 'A total production outage should score near critical').toBeGreaterThan(
        2.5,
      );
      const expectedScore = Object.entries(answer.probabilities).reduce(
        (total, [level, p]) => total + Number(level) * p,
        0,
      );
      expect(answer.score, 'Score must equal the probability-weighted rubric index').toBeCloseTo(
        expectedScore,
        6,
      );
      expect(calls, 'Score must make exactly one request').toBe(1);
    });
  },
);

it.skipIf(process.env.LIVE !== '1')(
  'verifies one canonical Choice with stable ids against TypeSafe',
  { timeout: 60_000, retry: 0 },
  async () => {
    const key = (process.env.GG_JEV_API_KEY ?? process.env.JEV_API_KEY)?.trim();
    if (!key)
      throw new Error(
        'No existing GG_JEV_API_KEY or JEV_API_KEY is available for the requested live Choice check',
      );
    await safely(key, async () => {
      let calls = 0;
      const decider = createJevDecider({
        secrets: { resolve: () => Promise.resolve(key) },
        timeoutMs: 30_000,
        retry: { maxRetries: 0 },
        fetch: async (url, init) => {
          calls += 1;
          if (calls > 1) throw new Error('Live Choice exceeded its one-call budget');
          return globalThis.fetch(url, init);
        },
      });
      await decider.init();
      expect(decider.available()).toBe(true);
      const result = await decider.choose(
        {
          question: 'Choose the option whose criterion exactly matches context.status.',
          options: [
            { id: 'ready', label: '1', criteria: 'The context status is exactly READY' },
            { id: 'revise', label: '2', criteria: 'The context status is exactly NEEDS_WORK' },
            { id: 'discard', label: '3', criteria: 'The context status is exactly DISCARD' },
          ],
          context: { status: 'READY' },
        },
        new AbortController().signal,
      );
      expect(result).toMatchObject({ type: 'choice', optionId: 'ready' });
      expect(Object.keys(result.probabilities ?? {}).sort()).toEqual([
        'discard',
        'ready',
        'revise',
      ]);
      documented(probability, result.confidence, 'Choice.confidence');
      for (const value of Object.values(result.probabilities ?? {}))
        documented(probability, value, 'Choice.probability');
      expect(calls).toBe(1);
      report('canonical Choice', { calls, model: DEFAULT_MODEL, answer: result }, key);
    });
  },
);
