import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JsonValueSchema,
  VOICE_CONFIG_KEY,
  VOICE_NORMALIZER_COMMAND,
} from '@graphgoblin/contracts';
import type { ContextThread } from '@graphgoblin/contracts';
import type { ScriptRunRequest } from '@graphgoblin/engine';
import { VoiceProviderError } from '@graphgoblin/infrastructure/process';
import {
  stableHash,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  SYSTEM_CHAT_TEXT_PROMPT,
} from '@graphgoblin/domain';
import { VoiceService, VoiceScripts } from './voice-service.js';
import { voiceProbeSample } from './voice-sample.js';
import { createTestApp, type TestApp } from '../testing/test-app.js';

let t: TestApp;
const cloud = {
  provider: 'openai' as const,
  model: 'gpt-transcribe' as const,
  secretName: 'voice.openai.transcription',
};
const sampleText = 'My fellow Americans ask what your country can do';
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

function fakeCloud() {
  const runner = { run: vi.fn() };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ text: sampleText }))));
  const voice = new VoiceService(t.container, runner, fetcher);
  t.container.voice = voice;
  t.container.ports.scripts = new VoiceScripts(runner, voice);
  return { voice, fetcher, runner };
}
async function configureCloud(voice: VoiceService) {
  await t.container.repos.secretsFor('local').set(cloud.secretName, 'PRIVATE_TRANSCRIPTION_KEY');
  await voice.update('local', {
    expectedRevision: 0,
    enabled: true,
    mode: 'cloud',
    cloudFallbackAllowed: false,
    cloud,
  });
  await voice.probe('local', 'cloud', 1, true);
}
async function publishPreset(voice = t.container.voice, revision = 0) {
  const [item] = await voice.loops('local');
  if (!item) throw new Error('Missing gateway fixture');
  const preview = await voice.preview('local', item.loopId, item.definitionHash, revision);
  await t.container.repos.loops.saveDraft(item.loopId, preview.definition);
  await t.container.repos.loops.publish(item.loopId, preview.definition);
  return preview;
}
function uploadHeaders(wav: Buffer, authorization?: string) {
  return {
    'content-type': 'audio/wav',
    'idempotency-key': randomUUID(),
    'x-content-sha256': createHash('sha256').update(wav).digest('hex'),
    ...(authorization ? { authorization } : {}),
  };
}

describe('cloud voice admission and pinned execution', () => {
  it('binds paired-device cloud execution to admitted audio and refuses a credential revoked after route selection', async () => {
    const { voice, fetcher, runner } = fakeCloud();
    await configureCloud(voice);
    await publishPreset(voice, 1);
    const token = `ggd_${'A'.repeat(43)}`;
    const authorization = `Bearer ${token}`;
    const codeHash = 'a'.repeat(64);
    await t.container.repos.chat.createPairing(
      'local',
      codeHash,
      new Date(t.clock.now().getTime() + 600_000).toISOString(),
    );
    const device = await t.container.repos.chat.claimPairing({
      codeHash,
      claimId: randomUUID(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      label: 'Voice phone',
    });
    const conversation = await t.container.repos.chat.createConversation({
      ownerId: 'local',
      audienceKey: `device:${device.id}`,
    });
    const wav = voiceProbeSample();
    const upload = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers: uploadHeaders(wav, authorization),
      payload: wav,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    fetcher.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ text: 'Device transcript' }))),
    );
    t.harness.script([{ finalText: 'Heard on the phone' }]);
    const send = async (audioId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/chat/conversations/${conversation.id}/turns`,
        headers: { authorization },
        payload: { requestId: randomUUID(), input: { kind: 'audio', audioId } },
      });
    const accepted = await send(upload.json().id);
    expect(accepted.statusCode, accepted.body).toBe(202);
    await t.idle();
    const turn = (
      await t.app.inject({ url: `/chat/turns/${accepted.json().id}`, headers: { authorization } })
    ).json();
    expect(turn).toMatchObject({
      runStatus: 'succeeded',
      inputTranscript: 'Device transcript',
      voice: { route: 'cloud', cloudProvider: 'OpenAI' },
      response: { reply: 'Heard on the phone' },
    });
    expect(JSON.stringify(turn)).not.toContain('PRIVATE_TRANSCRIPTION_KEY');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(runner.run).not.toHaveBeenCalled();

    // Recheck the actual pinned helper against file/metadata tampering after successful admission.
    const thread = await t.container.repos.runs.getInitialThread(turn.runId);
    const version = await t.container.repos.loops.getVersion(thread!.run.versionId);
    const helper = version!.definition.nodes.find((node) => node.id === 'chat-normalize');
    if (helper?.kind !== 'script') throw new Error('Missing fixture helper');
    const request: ScriptRunRequest = {
      command: VOICE_NORMALIZER_COMMAND,
      args: [],
      cwd: t.dataDir,
      env: { GG_VOICE_CONFIG: helper.config.env!.GG_VOICE_CONFIG! },
      stdin: JSON.stringify(thread),
      signal: new AbortController().signal,
    };
    const audio = await t.container.repos.chat.getAudio(
      { ownerId: 'local', audienceKey: `device:${device.id}` },
      upload.json().id,
    );
    if (!audio) throw new Error('Missing admitted audio');
    const audioRead = vi.spyOn(t.container.repos.chat, 'getAudio');
    for (const metadata of [
      undefined,
      { ...audio, path: join(t.dataDir, 'unadmitted-file.wav') },
      { ...audio, bytes: audio.bytes + 2 },
      { ...audio, mimeType: 'audio/mpeg' },
      { ...audio, state: 'ready' as const },
    ]) {
      audioRead.mockResolvedValueOnce(metadata);
      expect(await voice.normalize(request)).toMatchObject({ stderr: 'VOICE_AUDIO_UNAVAILABLE' });
    }
    audioRead.mockRestore();
    const altered = Buffer.from(wav);
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
    await writeFile(audio.path, altered);
    expect(await voice.normalize(request)).toMatchObject({ stderr: 'VOICE_AUDIO_CHANGED' });
    await writeFile(audio.path, wav);
    const unavailableRoute = vi.spyOn(voice, 'route').mockResolvedValueOnce({
      ready: false,
      cloudFallbackAllowed: false,
      message: 'Retest voice.',
    });
    expect(await voice.normalize(request)).toMatchObject({ stderr: 'VOICE_NOT_READY' });
    unavailableRoute.mockRestore();
    const configured = await voice.config('local');
    await t.container.repos.settings.set(
      'local',
      VOICE_CONFIG_KEY,
      JsonValueSchema.parse({ ...configured, enabled: false }),
    );
    expect(await voice.normalize(request)).toMatchObject({ stderr: 'VOICE_CONFIG_CHANGED' });
    await t.container.repos.settings.set(
      'local',
      VOICE_CONFIG_KEY,
      JsonValueSchema.parse(configured),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);

    const nextUpload = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers: uploadHeaders(wav, authorization),
      payload: wav,
    });
    expect(nextUpload.statusCode).toBe(201);
    const route = voice.route.bind(voice);
    vi.spyOn(voice, 'route').mockImplementation(async (...args) => {
      const selected = await route(...args);
      // Model the owner revoking a credential between selection and the provider dispatch.
      await t.container.repos.secretsFor('local').delete(cloud.secretName);
      return selected;
    });
    const revoked = await send(nextUpload.json().id);
    expect(revoked.statusCode, revoked.body).toBe(202);
    await t.idle();
    expect(
      (
        await t.app.inject({ url: `/chat/turns/${revoked.json().id}`, headers: { authorization } })
      ).json(),
    ).toMatchObject({
      runStatus: 'failed',
      voice: { route: 'cloud' },
      error: { code: 'VOICE_SECRET_MISSING' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(t.harness.started).toHaveLength(1);
  });

  it('requires explicit permission for automatic cloud routing and fresh qualification after each policy change', async () => {
    const { voice } = fakeCloud();
    await t.container.repos.secretsFor('local').set(cloud.secretName, 'test-key');
    for (const [index, policy] of [
      { mode: 'auto' as const, cloudFallbackAllowed: false, ready: false },
      { mode: 'auto' as const, cloudFallbackAllowed: true, ready: true },
      { mode: 'local' as const, cloudFallbackAllowed: true, ready: false },
    ].entries()) {
      await voice.update('local', {
        expectedRevision: index,
        enabled: true,
        cloud,
        mode: policy.mode,
        cloudFallbackAllowed: policy.cloudFallbackAllowed,
      });
      expect((await voice.route('local')).ready).toBe(false);
      await voice.probe('local', 'cloud', index + 1, true);
      expect((await voice.route('local')).ready).toBe(policy.ready);
    }
  });

  it('does not cache a cloud qualification if the credential changes during the sample', async () => {
    const { voice, fetcher } = fakeCloud();
    await t.container.repos.secretsFor('local').set(cloud.secretName, 'before');
    await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'cloud',
      cloudFallbackAllowed: false,
      cloud,
    });
    fetcher.mockImplementationOnce(async () => {
      await t.container.repos.secretsFor('local').set(cloud.secretName, 'after');
      return new Response(JSON.stringify({ text: sampleText }));
    });
    await expect(voice.probe('local', 'cloud', 1, true)).rejects.toMatchObject({
      code: 'VOICE_PROBE_STALE',
    });
    expect(await voice.probes('local')).toEqual([]);
    expect((await voice.route('local')).ready).toBe(false);
  });
});

describe('guided setup failures and acknowledgement recovery', () => {
  it('rejects relative local paths and admits only one concurrent configuration revision', async () => {
    const voice = t.container.voice;
    for (const local of [
      { executable: 'whisper-cli', modelPath: '/models/tiny.bin' },
      { executable: '/bin/whisper-cli', modelPath: 'tiny.bin' },
    ]) {
      await expect(
        voice.update('local', {
          expectedRevision: 0,
          enabled: true,
          mode: 'local',
          cloudFallbackAllowed: false,
          local,
        }),
      ).rejects.toMatchObject({ code: 'VOICE_LOCAL_PATH_INVALID' });
    }
    const value = {
      expectedRevision: 0,
      enabled: true,
      mode: 'cloud' as const,
      cloudFallbackAllowed: false,
      cloud,
    };
    const results = await Promise.allSettled([
      voice.update('local', value),
      voice.update('local', value),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({
      code: 'VOICE_CONFIG_STALE',
    });
    expect((await voice.config('local')).revision).toBe(1);
  });

  it('keeps missing connections unavailable and never dispatches their sample to another route', async () => {
    const { voice, fetcher, runner } = fakeCloud();
    await expect(voice.probe('local', 'cloud', 1, true)).rejects.toMatchObject({
      code: 'VOICE_CONFIG_STALE',
    });
    await expect(voice.probe('local', 'cloud', 0)).rejects.toMatchObject({
      code: 'VOICE_CLOUD_DISCLOSURE_REQUIRED',
    });
    for (const route of ['local', 'cloud'] as const) {
      const probe = await voice.probe('local', route, 0, true);
      expect(probe).toMatchObject({
        suitable: false,
        message: expect.stringContaining('Check its configuration'),
      });
      expect(probe).not.toHaveProperty('transcript');
    }
    await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'cloud',
      cloudFallbackAllowed: false,
      cloud,
    });
    expect((await voice.probe('local', 'cloud', 1, true)).suitable).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('offers model download for a qualified runtime but refuses an unverified selected model', async () => {
    const executable = join(t.dataDir, 'fixture-runtime');
    await writeFile(executable, 'fixture', { mode: 0o700 });
    const runner = { run: vi.fn() };
    const voice = new VoiceService(t.container, runner, vi.fn(), {
      inspectModel: () =>
        Promise.resolve({
          qualified: false,
          message: 'Select an allowlisted voice model.',
        }),
    });
    vi.spyOn(voice.installer, 'inspect').mockResolvedValue({
      qualified: true,
      message: 'Reviewed fixture',
    });
    const setup = await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'local',
      cloudFallbackAllowed: false,
      local: { executable, modelPath: join(t.dataDir, 'missing-model') },
    });
    expect(setup.local).toMatchObject({
      available: false,
      installSupported: true,
      message: expect.stringContaining('Download'),
    });
    await expect(voice.probe('local', 'local', 1)).rejects.toMatchObject({
      code: 'VOICE_MODEL_UNSUPPORTED',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('does not qualify an installed model with an unreviewed or changed runtime', async () => {
    const executable = join(t.dataDir, 'unreviewed-runtime');
    const modelPath = join(t.dataDir, 'fixture-model');
    await writeFile(executable, 'fixture', { mode: 0o700 });
    await writeFile(modelPath, 'fixture model');
    const runner = { run: vi.fn() };
    const voice = new VoiceService(t.container, runner, vi.fn(), {
      inspectModel: () =>
        Promise.resolve({ qualified: true, message: 'Allowlisted fixture model' }),
    });
    vi.spyOn(voice.installer, 'inspect').mockResolvedValue({
      qualified: false,
      message: 'Runtime identity changed. Review it before testing.',
    });
    const setup = await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'local',
      cloudFallbackAllowed: false,
      local: { executable, modelPath },
    });
    expect(setup.local).toMatchObject({ available: false, installSupported: false });
    expect(setup.route.ready).toBe(false);
    await expect(voice.probe('local', 'local', 1)).rejects.toMatchObject({
      code: 'VOICE_RUNTIME_UNSUPPORTED',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('retains a sanitized failed operation without replaying a provider or an unexpected exception', async () => {
    const voice = t.container.voice;
    const probe = vi.spyOn(voice, 'probe');
    for (const [error, code] of [
      [new Error('PRIVATE_INTERNAL_DIAGNOSTIC'), 'VOICE_OPERATION_FAILED'],
      [
        new VoiceProviderError('VOICE_RUNTIME_UNSUPPORTED', 'PRIVATE_NATIVE_DIAGNOSTIC'),
        'VOICE_RUNTIME_UNSUPPORTED',
      ],
    ] as const) {
      probe.mockRejectedValueOnce(error);
      const body = {
        operationId: randomUUID(),
        route: 'local' as const,
        expectedConfigRevision: 0,
      };
      expect(
        (await t.app.inject({ method: 'POST', url: '/chat/voice/probe', payload: body }))
          .statusCode,
      ).toBe(202);
      await vi.waitFor(async () =>
        expect(await voice.operation('local', body.operationId, 'probe')).toMatchObject({
          state: 'failed',
          code,
        }),
      );
      const recovered = await t.app.inject({ url: `/chat/voice/probes/${body.operationId}` });
      expect(recovered.body).not.toContain('PRIVATE_');
      expect(
        (await t.app.inject({ method: 'POST', url: '/chat/voice/probe', payload: body })).json(),
      ).toMatchObject({ state: 'failed', code });
    }
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('returns a bounded admission error when setup identity capacity is exhausted', async () => {
    vi.spyOn(t.container.repos.settings, 'beginVoiceOperation').mockResolvedValue('capacity');
    const probe = vi.spyOn(t.container.voice, 'probe');
    const response = await t.app.inject({
      method: 'POST',
      url: '/chat/voice/probe',
      payload: {
        operationId: randomUUID(),
        route: 'local',
        expectedConfigRevision: 0,
      },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: 'VOICE_OPERATION_CAPACITY',
      detail: expect.stringContaining('Existing operation checks remain available'),
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not install after configuration changes during setup, and preserves failed installation identity', async () => {
    const voice = t.container.voice;
    await expect(
      voice.startInstall('local', {
        operationId: randomUUID(),
        expectedConfigRevision: 1,
        modelId: 'tiny.en',
      }),
    ).rejects.toMatchObject({ code: 'VOICE_CONFIG_STALE' });
    const snapshot = await voice.setup('local');
    vi.spyOn(voice, 'setup').mockImplementationOnce(async () => {
      await t.container.repos.settings.set(
        'local',
        VOICE_CONFIG_KEY,
        JsonValueSchema.parse({ ...snapshot.config, revision: 1 }),
      );
      return snapshot;
    });
    const install = vi.spyOn(voice.installer, 'start').mockImplementation(() => {
      voice.installer.progress = { state: 'failed', phase: 'Download refused', downloadedBytes: 0 };
      return Promise.resolve();
    });
    const first = {
      operationId: randomUUID(),
      expectedConfigRevision: 0,
      modelId: 'tiny.en' as const,
    };
    await voice.startInstall('local', first);
    await vi.waitFor(async () =>
      expect(await voice.operation('local', first.operationId, 'install')).toMatchObject({
        state: 'failed',
        code: 'VOICE_CONFIG_STALE',
      }),
    );
    expect(install).not.toHaveBeenCalled();
    const second = { ...first, operationId: randomUUID(), expectedConfigRevision: 1 };
    await voice.startInstall('local', second);
    await vi.waitFor(async () =>
      expect(await voice.operation('local', second.operationId, 'install')).toMatchObject({
        state: 'failed',
        code: 'VOICE_INSTALL_FAILED',
      }),
    );
    await voice.startInstall('local', second);
    expect(install).toHaveBeenCalledTimes(1);
  });
});

it('refreshes an existing preset precisely and refuses stale or foreign editor previews', async () => {
  const voice = t.container.voice;
  const first = await publishPreset(voice);
  expect((await voice.loops('local'))[0]).toMatchObject({
    classification: 'current',
    published: true,
  });
  const definition = structuredClone(first.definition);
  const helper = definition.nodes.find((node) => node.id === 'chat-normalize');
  const respond = definition.nodes.find((node) => node.id === 'respond');
  if (helper?.kind !== 'script' || respond?.kind !== 'inference')
    throw new Error('Missing preset fixture nodes');
  helper.label = 'Keep my label';
  helper.config.env = { ...helper.config.env, AUTHORED_NONSECRET: 'keep' };
  respond.config.prompt.template = SYSTEM_CHAT_TEXT_PROMPT;
  await t.container.repos.loops.saveDraft(first.loopId, definition);
  const hash = stableHash(definition);
  await voice.update('local', {
    expectedRevision: 0,
    enabled: false,
    mode: 'auto',
    cloudFallbackAllowed: false,
  });
  expect((await voice.loops('local'))[0]?.classification).toBe('customized');
  await expect(voice.preview('local', first.loopId, hash, 0)).rejects.toMatchObject({
    code: 'VOICE_CONFIG_STALE',
  });
  await expect(voice.preview('another-owner', first.loopId, hash, 0)).rejects.toMatchObject({
    code: 'CHAT_NOT_FOUND',
  });
  await expect(voice.preview('local', first.loopId, '0'.repeat(16), 1)).rejects.toMatchObject({
    code: 'VOICE_DRAFT_STALE',
  });
  const refreshed = await voice.preview('local', first.loopId, hash, 1);
  const refreshedHelper = refreshed.definition.nodes.find((node) => node.id === 'chat-normalize');
  const refreshedRespond = refreshed.definition.nodes.find((node) => node.id === 'respond');
  expect(refreshedHelper).toMatchObject({
    label: 'Keep my label',
    config: {
      env: {
        AUTHORED_NONSECRET: 'keep',
        GG_VOICE_CONFIG: JSON.stringify(await voice.config('local')),
      },
    },
  });
  expect(
    refreshedRespond?.kind === 'inference' ? refreshedRespond.config.prompt.template : undefined,
  ).toBe(SYSTEM_CHAT_SCRIPT_PROMPT);
  // A preview is pure even when it updates the canonical prompt and configuration snapshot.
  const loop = await t.container.repos.loops.getLoop(first.loopId);
  expect((await t.container.repos.loops.getVersion(loop!.draftVersionId!))!.definition).toEqual(
    definition,
  );
});

describe('protected normalizer input', () => {
  it('accepts admitted text while rejecting forged run, helper, input and caller authority before any provider work', async () => {
    const { voice, runner, fetcher } = fakeCloud();
    const preview = await publishPreset(voice);
    const conversation = await t.container.repos.chat.createConversation({
      ownerId: 'local',
      audienceKey: 'gateway',
    });
    t.harness.script([{ finalText: 'Ordinary text reply' }]);
    const accepted = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversation.id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'text', text: 'Admitted text' },
      },
    });
    expect(accepted.statusCode).toBe(202);
    await t.idle();
    const turn = (await t.app.inject({ url: `/chat/turns/${accepted.json().id}` })).json();
    const thread = await t.container.repos.runs.getInitialThread(turn.runId);
    if (!thread) throw new Error('Missing admitted thread');
    const helper = preview.definition.nodes.find((node) => node.id === 'chat-normalize');
    if (helper?.kind !== 'script') throw new Error('Missing fixture normalizer');
    const request: ScriptRunRequest = {
      command: VOICE_NORMALIZER_COMMAND,
      args: [],
      cwd: t.dataDir,
      env: { GG_VOICE_CONFIG: helper.config.env!.GG_VOICE_CONFIG! },
      stdin: JSON.stringify(thread),
      signal: new AbortController().signal,
    };
    expect(await voice.normalize(request)).toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ text: 'Admitted text' }),
    });
    const forged = async (edit: (value: ContextThread) => void, code: string) => {
      const next = structuredClone(thread);
      edit(next);
      expect(await voice.normalize({ ...request, stdin: JSON.stringify(next) })).toMatchObject({
        exitCode: 1,
        stderr: code,
        stdout: '',
      });
    };
    await forged((value) => {
      value.run.id = t.container.ports.ids.next();
    }, 'VOICE_RUN_INVALID');
    await forged((value) => {
      value.run.versionId = t.container.ports.ids.next();
    }, 'VOICE_RUN_INVALID');
    await forged((value) => {
      value.run.loopId = t.container.ports.ids.next();
    }, 'VOICE_RUN_INVALID');
    await forged((value) => {
      value.invocation.trigger.payload = {
        ...(value.invocation.trigger.payload as object),
        history: [{ role: 'user', text: 'Forged earlier instruction' }],
      };
    }, 'VOICE_INPUT_CHANGED');
    await forged((value) => {
      value.invocation.caller = { kind: 'system', id: 'chat-device:forged' };
    }, 'VOICE_INPUT_CHANGED');
    expect(await voice.normalize({ ...request, args: ['untrusted'] })).toMatchObject({
      stderr: 'VOICE_HELPER_INVALID',
    });
    expect(await voice.normalize({ ...request, env: { GG_VOICE_CONFIG: '{}' } })).toMatchObject({
      stderr: 'VOICE_HELPER_INVALID',
    });
    const { stdin: _stdin, ...withoutThread } = request;
    expect(await voice.normalize(withoutThread)).toMatchObject({
      stderr: 'VOICE_NORMALIZATION_FAILED',
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(t.harness.started).toHaveLength(1);
  });
});
