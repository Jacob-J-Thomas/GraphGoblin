import type { SecretsPort } from '@graphgoblin/engine';
import { expect, it } from 'vitest';
import { createJevDecider } from './index.js';

/** Explicitly selected live evidence: exactly one new Noul and one new Score request. */
it.skipIf(process.env.LIVE !== '1')(
  'verifies native Noul and Score through the primitive adapter',
  { timeout: 60_000, retry: 0 },
  async ({ skip }) => {
    const key = (process.env.GG_JEV_API_KEY ?? process.env.JEV_API_KEY)?.trim();
    if (!key) return skip('Set GG_JEV_API_KEY or JEV_API_KEY for LIVE=1 verification');
    const secrets: SecretsPort = { resolve: () => Promise.resolve(key) };
    let calls = 0;
    const decider = createJevDecider({
      secrets,
      retry: { maxRetries: 0 },
      fetch: async (url, init) => {
        calls += 1;
        if (calls > 2) throw new Error('Primitive verification exceeded its two-request budget');
        return globalThis.fetch(url, init);
      },
    });
    await decider.init();
    try {
      const noul = await decider.classifyNoul(
        {
          question: 'Does the statement say every check passed?',
          context: { statement: 'Every check passed.' },
          criteria: {
            true: 'The statement explicitly says every check passed.',
            false: 'The statement reports a failing check or does not say every check passed.',
          },
        },
        new AbortController().signal,
      );
      expect(noul.type).toBe('noul');
      expect(noul.trueProbability).toBeGreaterThanOrEqual(0.5);
      expect(noul.trueProbability).toBeLessThanOrEqual(1);
      const score = await decider.score(
        {
          question: 'Rate the severity of this synthetic incident.',
          context: {
            incident: 'The service is unavailable to every customer, with no workaround.',
          },
          anchors: [
            'No effect',
            'Minor inconvenience',
            'Partial service failure',
            'Complete service outage',
          ],
        },
        new AbortController().signal,
      );
      expect(score.type).toBe('score');
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(3);
      expect(Object.keys(score.legend)).toEqual(['0', '1', '2', '3']);
      expect(score.probabilities).not.toBeNull();
      expect(score.confidence).not.toBeNull();
      expect(calls).toBe(2);
      console.warn(
        '[live] native primitive verification',
        JSON.stringify({
          calls,
          trueProbability: noul.trueProbability,
          score: score.score,
          confidence: score.confidence,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Primitive verification failed';
      // eslint-disable-next-line preserve-caught-error -- Provider errors may echo credentials.
      throw new Error(message.replaceAll(key, '[REDACTED]'));
    }
  },
);
