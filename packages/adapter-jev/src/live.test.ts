import type { SecretsPort } from '@graphgoblin/engine';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createJevDecider } from './index.js';

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

it.skipIf(process.env.LIVE !== '1')(
  'verifies Choice and Noul against the TypeSafe API',
  { timeout: 60_000, retry: 0 },
  async () => {
    const key = process.env.JEV_API_KEY?.trim();
    if (!key) {
      throw new Error(
        'JEV_API_KEY must be set in this terminal to run the LIVE=1 Jev verification',
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
      console.warn(
        '[live] Choice',
        JSON.stringify({
          model: rawChoice.model.replaceAll(key, '[REDACTED]'),
          usage: rawChoice.usage,
          confidence: answer.confidence,
          chosenProbability: answer.probabilities[answer.choice],
        }),
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
      console.warn(
        '[live] Noul',
        JSON.stringify({
          model: rawNoul.model.replaceAll(key, '[REDACTED]'),
          usage: rawNoul.usage,
        }),
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
