import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessEvent, HarnessSession } from '@graphgoblin/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodexAdapters } from './adapters.js';

/**
 * Live smoke test against the real Codex CLI and the owner's subscription. Skipped unless LIVE=1.
 * Uses the development model `gpt-6-luna` at `low` effort and a read-only sandbox.
 *
 *   LIVE=1 pnpm --filter @graphgoblin/adapter-codex test -- src/live.test.ts
 */
const live = process.env.LIVE === '1';

async function drain(session: HarnessSession): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const event of session.events) out.push(event);
  return out;
}

/** Processes, other than this probe, whose command line contains the marker. Windows only. */
function countProcesses(marker: string): number {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.CommandLine -notlike '*Get-CimInstance*' }).Count`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return Number(out.trim());
}

describe.skipIf(!live)('Codex live smoke', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graphgoblin-live-'));
  const { harness, decider } = createCodexAdapters({ model: 'gpt-6-luna', effort: 'low' });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('passes preflight', async () => {
    const result = await harness.preflight();
    console.warn('[live] preflight', JSON.stringify(result));
    expect(result).toMatchObject({ ok: true, authenticated: true });
  }, 60_000);

  it('starts a session and resumes it', async () => {
    const options = { sandbox: 'read-only', approval: 'never' } as const;
    const first = harness.start(
      {
        workingDirectory: dir,
        options,
        turn: { prompt: 'Remember the word PUMPKIN. Reply with exactly OK and nothing else.' },
      },
      new AbortController().signal,
    );
    const firstEvents = await drain(first);
    const firstResult = await first.result;
    const sessionId = await first.sessionId;
    console.warn(
      '[live] start',
      JSON.stringify({
        sessionId,
        events: firstEvents.map((e) => e.type),
        finalText: firstResult.finalText,
        usage: firstResult.usage,
      }),
    );
    expect(sessionId).toMatch(/\S/);
    expect(firstEvents[0]).toEqual({ type: 'session', sessionId, mode: 'fresh' });
    expect(firstResult.finalText.trim()).toMatch(/OK/);
    expect(firstResult.usage.inputTokens).toBeGreaterThan(0);

    const second = harness.resume(
      sessionId,
      {
        workingDirectory: dir,
        options,
        turn: { prompt: 'What word did I ask you to remember? Reply with the word only.' },
      },
      new AbortController().signal,
    );
    const secondEvents = await drain(second);
    const secondResult = await second.result;
    console.warn(
      '[live] resume',
      JSON.stringify({
        sessionId: await second.sessionId,
        events: secondEvents.map((e) => (e.type === 'session' ? `session:${e.sessionId}` : e.type)),
        finalText: secondResult.finalText,
        usage: secondResult.usage,
      }),
    );
    expect(await second.sessionId).toBe(sessionId);
    expect(secondResult.finalText.toUpperCase()).toContain('PUMPKIN');
    expect(secondResult.usage.inputTokens).toBeGreaterThan(0);
  }, 300_000);

  it.skipIf(process.platform !== 'win32')(
    'cancel ends the CLI and the command it was running',
    async () => {
      const marker = `ggsleep${Date.now()}`;
      const session = harness.start(
        {
          workingDirectory: dir,
          options: { sandbox: 'workspace-write', approval: 'never' },
          turn: {
            prompt: `Run exactly this shell command and wait for it to finish: powershell -NoProfile -Command "Start-Sleep -Seconds 120; Write-Output ${marker}"`,
          },
        },
        new AbortController().signal,
      );
      // Wait until the command is visibly running, which also proves the probe can find it.
      let running = 0;
      for (let i = 0; i < 90 && running === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        running = countProcesses(marker);
      }
      expect(running).toBeGreaterThan(0);
      await session.cancel();
      await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const survivors = countProcesses(marker);
      console.warn('[live] cancel', JSON.stringify({ runningBeforeCancel: running, survivors }));
      expect(survivors).toBe(0);
    },
    300_000,
  );

  it('makes a structured decision', async () => {
    const result = await decider.choose(
      {
        question: 'A pull request only fixes a typo in a README and all checks pass. What next?',
        options: [
          { label: 'merge', description: 'the change is ready' },
          { label: 'revise', description: 'the change needs more work' },
        ],
        context: {},
      },
      new AbortController().signal,
    );
    console.warn('[live] choose', JSON.stringify(result));
    expect(['merge', 'revise']).toContain(result.label);
  }, 300_000);
});
