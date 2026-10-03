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
      choice: z.enum(['billing', 'bug', 'feature request', 'account', 'other']),
      confidence: probability,
      probabilities: z
        .object({
          billing: probability,
          bug: probability,
          'feature request': probability,
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
        { label: 'ship', description: 'The change is ready to release' },
        { label: 'fix', description: 'The change needs corrections' },
        { label: 'drop', description: 'The change should be abandoned' },
      ];
      const context = { change: 'Fix a README typo', testsPassed: true, unresolvedIssues: 0 };
      const chosen = await decider.choose(
        { question: 'What should happen next to this change?', options, context },
        new AbortController().signal,
      );
      const rawChoice = documented(choiceSchema, responses[0], 'Choice');
      const answer = rawChoice.answers.answer;
      expect(
        options.some((option) => option.label === chosen.label),
        'Choice.label must be a declared route (docs/research/jev.md)',
      ).toBe(true);
      documented(probability, chosen.confidence, 'Choice.confidence');
      expect(chosen.label, 'Choice.label must match answers.answer.choice').toBe(answer.choice);
      expect(chosen.confidence, 'Choice.confidence must preserve answers.answer.confidence').toBe(
        answer.confidence,
      );
      const alternatives = chosen.alternatives ?? [];
      expect(
        alternatives.map((alternative) => alternative.label).sort(),
        'Choice.alternatives must cover exactly the other route labels (docs/research/jev.md)',
      ).toEqual(
        options
          .map((option) => option.label)
          .filter((label) => label !== chosen.label)
          .sort(),
      );
      for (const alternative of alternatives) {
        documented(probability, alternative.confidence, `Choice.alternatives.${alternative.label}`);
        expect(
          alternative.confidence,
          `Choice.alternatives.${alternative.label}.confidence must equal its raw probability`,
        ).toBe(answer.probabilities[alternative.label as keyof typeof answer.probabilities]);
      }
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

      const judged = await decider.judge(
        {
          question: 'Are all tests passing and all issues resolved so the loop can exit?',
          context,
        },
        new AbortController().signal,
      );
      const rawNoul = documented(noulSchema, responses[1], 'Noul');
      const yes = rawNoul.answers.answer.noul;
      expect(typeof judged.holds, 'Noul.holds must be boolean (docs/research/jev.md)').toBe(
        'boolean',
      );
      documented(probability, judged.confidence, 'Noul.confidence');
      expect(judged.holds, 'Noul.holds must reflect answers.answer.noul >= 0.5').toBe(yes >= 0.5);
      expect(
        judged.confidence,
        'Noul.confidence must be the probability of the returned boolean',
      ).toBe(judged.holds ? yes : 1 - yes);
      report(
        'Noul',
        {
          model: rawNoul.model,
          usage: rawNoul.usage,
          noul: yes,
          holds: judged.holds,
          confidence: judged.confidence,
          chosenProbability: judged.holds ? yes : 1 - yes,
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
        { label: 'billing', description: 'Invoices, payments, charges, or refunds' },
        { label: 'bug', description: 'Broken product functionality or software errors' },
        { label: 'feature request', description: 'A request for new product functionality' },
        { label: 'account', description: 'Login, password, or account access problems' },
        { label: 'other', description: 'Any message outside these categories' },
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
      expect(chosen.label, 'Classification must choose billing').toBe('billing');
      expect(chosen.label, 'Classification must preserve the raw choice').toBe(answer.choice);
      documented(probability, chosen.confidence, 'Classification.confidence');
      expect(chosen.confidence, 'Classification must preserve reported confidence').toBe(
        answer.confidence,
      );
      expect(
        Object.keys(answer.probabilities).sort(),
        'Probabilities must cover all five labels',
      ).toEqual(options.map((option) => option.label).sort());
      expect(chosen.alternatives?.map((alternative) => alternative.label).sort()).toEqual(
        options
          .map((option) => option.label)
          .filter((label) => label !== chosen.label)
          .sort(),
      );
      for (const alternative of chosen.alternatives ?? []) {
        expect(alternative.confidence).toBe(
          answer.probabilities[alternative.label as keyof typeof answer.probabilities],
        );
      }
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
