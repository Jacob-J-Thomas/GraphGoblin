import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LoopDefinitionSchema,
  type ChatAudioUpload,
  type ChatConversation,
  type ChatSession,
  type ChatTurn,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio } from '@graphgoblin/domain';
import type { Page } from '@playwright/test';
import { control, expect, test as base } from './fixtures.js';

/** Real Chromium media/worklet capture; speech recognition and the reply provider are fakes. */
const test = base.extend<object, { publicAudioFile: string }>({
  publicAudioFile: [
    // Playwright requires destructuring even when a fixture has no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const directory = await mkdtemp(join(tmpdir(), 'gg-e2e-public-voice-'));
      const path = join(directory, 'public-jfk.wav');
      // The bundled public-domain JFK sample, never an ambient or private microphone.
      try {
        const controlUrl = process.env['GG_E2E_CONTROL_URL'];
        if (!controlUrl) throw new Error('The disposable E2E control server is unavailable');
        const response = await fetch(`${controlUrl}/voice/public-sample`, { method: 'POST' });
        expect(response.ok).toBe(true);
        const sample = (await response.json()) as { wavBase64: string };
        await writeFile(path, Buffer.from(sample.wavBase64, 'base64'));
        await use(path);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  browser: [
    async ({ playwright, launchOptions, channel, headless, publicAudioFile }, use) => {
      const browser = await playwright.chromium.launch({
        ...launchOptions,
        ...(channel ? { channel } : {}),
        headless,
        args: [
          ...(launchOptions.args ?? []),
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${publicAudioFile}`,
        ],
      });
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: 'worker' },
  ],
});
test.use({ permissions: ['microphone'] });

interface CaptureEvidence {
  context: BaseAudioContext;
  sampleRate: number;
  chunks: number[];
  frames: number;
  stopped?: { sequence: number; frames: number };
}
declare global {
  interface Window {
    __ggVoiceCaptures: CaptureEvidence[];
  }
}

async function observeNativeWorklets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.__ggVoiceCaptures = [];
    // Pass through to the native constructor and observe messages. No PCM, ACK, media, or
    // timing implementation is replaced: the built app and Chromium run the actual worklet.
    window.AudioWorkletNode = class extends NativeAudioWorkletNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== 'goblin-pcm-capture') return;
        const evidence: CaptureEvidence = {
          context,
          sampleRate: context.sampleRate,
          chunks: [],
          frames: 0,
        };
        window.__ggVoiceCaptures.push(evidence);
        this.port.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
          if (!data || typeof data !== 'object') return;
          const message = data as Record<string, unknown>;
          if (message['type'] === 'chunk' && message['samples'] instanceof ArrayBuffer) {
            evidence.chunks.push(Number(message['sequence']));
            evidence.frames += message['samples'].byteLength / Float32Array.BYTES_PER_ELEMENT;
          } else if (message['type'] === 'stopped') {
            evidence.stopped = {
              sequence: Number(message['sequence']),
              frames: Number(message['frames']),
            };
          }
        });
      }
    };
  });
}

async function waitForAudio(page: Page, index: number): Promise<void> {
  // A sample-count wait, not a microphone-performance deadline or a simulated clock.
  await expect
    .poll(() =>
      page.evaluate((i) => {
        const capture = window.__ggVoiceCaptures[i];
        return capture ? capture.frames / capture.sampleRate : 0;
      }, index),
    )
    .toBeGreaterThanOrEqual(1);
}

async function playbackBytes(page: Page, index: number): Promise<Buffer> {
  const source = await page
    .getByLabel(`Play recording ${index + 1}`, { exact: true })
    .getAttribute('src');
  expect(source).toMatch(/^blob:/);
  return Buffer.from(
    await page.evaluate(
      async (url) => [...new Uint8Array(await (await fetch(url!)).arrayBuffer())],
      source,
    ),
  );
}

function canonicalWav(bytes: Buffer): { frames: number; durationMs: number } {
  expect(bytes.length).toBeGreaterThan(44);
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.subarray(8, 16).toString()).toBe('WAVEfmt ');
  expect(bytes.readUInt32LE(16)).toBe(16);
  expect(bytes.readUInt16LE(20)).toBe(1);
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect(bytes.readUInt32LE(24)).toBe(16_000);
  expect(bytes.readUInt32LE(28)).toBe(32_000);
  expect(bytes.readUInt16LE(32)).toBe(2);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.subarray(36, 40).toString()).toBe('data');
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  expect((bytes.length - 44) % 2).toBe(0);
  const pcm = bytes.subarray(44);
  let energy = 0;
  for (let offset = 0; offset < pcm.length; offset += 2)
    energy += bytes.readInt16LE(offset + 44) ** 2;
  expect(Math.sqrt(energy / (pcm.length / 2))).toBeGreaterThan(10);
  return { frames: pcm.length / 2, durationMs: (pcm.length / 2 / 16_000) * 1000 };
}

// This native process reads the API's saved recording. It checks transport/storage identity,
// then emits a deliberately labelled fake transcript; it does not claim to recognize speech.
const fixtureNormalizer = `
const fs = require('node:fs');
const crypto = require('node:crypto');
let input = '';
process.stdin.on('data', part => input += part);
process.stdin.on('end', () => {
  const payload = JSON.parse(input).invocation.trigger.payload.input;
  if (payload.kind === 'text') {
    console.log(JSON.stringify({ text: payload.text }));
    return;
  }
  const wav = fs.readFileSync(payload.audio.path);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      wav.readUInt32LE(4) !== wav.length - 8 || wav.readUInt32LE(24) !== 16000 ||
      wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16 ||
      wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44)
    throw new Error('Fixture received noncanonical WAV');
  const evidence = { bytes: wav.length, frames: (wav.length - 44) / 2,
    sha256: crypto.createHash('sha256').update(wav).digest('hex') };
  const transcript = 'Public JFK sample (fake STT): ' + JSON.stringify(evidence);
  console.log(JSON.stringify({ text: payload.caption ? payload.caption + '\\n\\n' + transcript : transcript }));
});
`;

for (const submit of ['Send button', 'textarea Enter'] as const) {
  test(`native AudioWorklet retains Stop, appends, and ${submit} submits complete audio once`, async ({
    page,
    request,
    publicAudioFile,
  }, testInfo) => {
    const instance = await control(request, '/apps', { requireApiKey: true });
    const url = String(instance['url']);
    const token = String(instance['token']);
    const headers = { authorization: `Bearer ${token}` };
    const sessionResponse = await request.get(`${url}/chat/session`, { headers });
    expect(sessionResponse.status()).toBe(200);
    const session = (await sessionResponse.json()) as ChatSession;
    expect(session.systemLoopId).toBeTruthy();
    const definition = enableChatAudio(
      createSystemChatDefinition({ name: 'Public fake-audio browser fixture', harness: 'codex' }),
      {
        id: 'chat-normalize',
        kind: 'script',
        label: 'Fixture fake STT',
        ui: { x: 160, y: 0 },
        config: {
          command: process.execPath,
          args: ['-e', fixtureNormalizer],
          cwd: 'workspace',
          stdin: 'thread',
          stdout: 'last-output',
        },
      },
    );
    expect(
      (
        await request.put(`${url}/loops/${session.systemLoopId!}/draft`, {
          headers,
          data: { definition: LoopDefinitionSchema.parse(definition) },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await request.post(`${url}/loops/${session.systemLoopId!}/publish`, { headers })).status(),
    ).toBe(200);
    const reply = `Real browser capture accepted through ${submit}; recognition is a fixture.`;
    await control(request, '/harness/script', {
      instanceId: instance['instanceId'],
      turns: [
        {
          matchPrompt: 'Typed fixture caption\n\nPublic JFK sample (fake STT):',
          finalText: reply,
        },
      ],
    });
    await observeNativeWorklets(page);
    await page.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), token);
    let uploads = 0;
    let turns = 0;
    page.on('request', (sent) => {
      if (sent.method() !== 'POST') return;
      const path = new URL(sent.url()).pathname;
      if (path === '/chat/audio') uploads++;
      if (/^\/chat\/conversations\/[^/]+\/turns$/.test(path)) turns++;
    });
    let releaseUpload!: () => void;
    const uploadHeld = new Promise<void>((done) => {
      releaseUpload = done;
    });
    let observedUpload!: (upload: {
      bytes: Buffer;
      audio: ChatAudioUpload;
      digest: string;
    }) => void;
    const receivedUpload = new Promise<{ bytes: Buffer; audio: ChatAudioUpload; digest: string }>(
      (done) => {
        observedUpload = done;
      },
    );
    await page.route('**/chat/audio', async (route) => {
      expect(route.request().method()).toBe('POST');
      const bytes = route.request().postDataBuffer()!;
      const digest = route.request().headers()['x-content-sha256']!;
      expect(route.request().headers()['content-type']).toBe('audio/wav');
      expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
      const received = await route.fetch();
      expect(received.status()).toBe(201);
      observedUpload({ bytes, audio: (await received.json()) as ChatAudioUpload, digest });
      await uploadHeld;
      await route.fulfill({ response: received });
    });
    try {
      await page.goto(`${url}/app/chat`);
      const message = page.getByRole('textbox', { name: 'Message', exact: true });
      await message.fill('Typed fixture caption');
      await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
      await waitForAudio(page, 0);
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
      await expect(
        page.getByRole('list', { name: 'Voice recordings' }).getByRole('listitem'),
      ).toHaveCount(1);
      const first = await playbackBytes(page, 0);
      const firstWav = canonicalWav(first);
      expect(uploads).toBe(0);
      expect(turns).toBe(0);
      await page.getByRole('button', { name: 'Add more voice', exact: true }).click();
      await waitForAudio(page, 1);
      await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
      expect(turns).toBe(0);
      expect(uploads).toBe(0);
      if (submit === 'Send button')
        await page.getByRole('button', { name: 'Send message' }).click();
      else await message.press('Enter');
      const uploaded = await receivedUpload;
      await expect(
        page.getByRole('list', { name: 'Voice recordings' }).getByRole('listitem'),
      ).toHaveCount(2);
      const second = await playbackBytes(page, 1);
      const secondWav = canonicalWav(second);
      const complete = canonicalWav(uploaded.bytes);
      expect(uploaded.bytes.subarray(44)).toEqual(
        Buffer.concat([first.subarray(44), second.subarray(44)]),
      );
      expect(complete.frames).toBe(firstWav.frames + secondWav.frames);
      expect(complete.durationMs).toBeGreaterThanOrEqual(2_000);
      expect(uploaded.digest).toBe(createHash('sha256').update(uploaded.bytes).digest('hex'));
      expect(uploaded.audio.bytes).toBe(uploaded.bytes.length);
      expect(uploaded.audio.mimeType).toBe('audio/wav');
      const capture = await page.evaluate(() =>
        window.__ggVoiceCaptures.map(({ context, ...evidence }) => ({
          ...evidence,
          state: context.state,
        })),
      );
      expect(capture).toHaveLength(2);
      for (const [index, item] of capture.entries()) {
        expect(item.state).toBe('closed');
        expect(item.stopped).toEqual({ sequence: item.chunks.length, frames: item.frames });
        expect(item.chunks).toEqual(Array.from({ length: item.chunks.length }, (_, i) => i + 1));
        expect([firstWav.frames, secondWav.frames][index]).toBe(
          Math.round((item.frames * 16_000) / item.sampleRate),
        );
      }
      // Repeat real keyboard Send while the gateway acknowledgement is deliberately held.
      await message.press('Enter');
      await message.press('Enter');
      expect(uploads).toBe(1);
      expect(turns).toBe(0);
      releaseUpload();
      await expect(page.locator('[data-chat-reply] p')).toHaveText(reply);
      expect(uploads).toBe(1);
      expect(turns).toBe(1);
      const conversations = (await (
        await request.get(`${url}/chat/conversations`, { headers })
      ).json()) as { items: ChatConversation[] };
      expect(conversations.items).toHaveLength(1);
      const history = (await (
        await request.get(`${url}/chat/conversations/${conversations.items[0]!.id}/turns`, {
          headers,
        })
      ).json()) as { items: ChatTurn[] };
      expect(history.items).toHaveLength(1);
      expect(history.items[0]).toMatchObject({
        runStatus: 'succeeded',
        input: { kind: 'audio', audioId: uploaded.audio.id, caption: 'Typed fixture caption' },
        inputTranscript:
          'Typed fixture caption\n\nPublic JFK sample (fake STT): ' +
          JSON.stringify({
            bytes: uploaded.bytes.length,
            frames: complete.frames,
            sha256: uploaded.digest,
          }),
        response: { reply },
      });
      const harness = await control(request, '/harness/requests', {
        instanceId: instance['instanceId'],
      });
      expect(harness['started']).toHaveLength(1);
      await expect(page.getByRole('list', { name: 'Voice recordings' })).toHaveCount(0);
      await testInfo.attach('public-audio-capture-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            submit,
            source: 'bundled public-domain voiceProbeSample; Chromium fake input only',
            sourceSha256: createHash('sha256')
              .update(await readFile(publicAudioFile))
              .digest('hex'),
            recognition: 'fake native fixture script; no STT/provider qualification',
            uploads,
            turns,
            frames: complete.frames,
            durationMs: complete.durationMs,
            sha256: uploaded.digest,
            capture,
          },
          null,
          2,
        ),
      });
    } finally {
      releaseUpload();
    }
  });
}
