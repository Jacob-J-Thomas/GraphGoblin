import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VoiceService, VoiceScripts } from './voice-service.js';
import { voiceProbeSample } from './voice-sample.js';
import type { ScriptRunResult } from '@graphgoblin/engine';
import {
  VOICE_CONFIG_KEY,
  VOICE_NORMALIZER_COMMAND,
  VoicePreviewSchema,
} from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { createTestApp, type TestApp } from '../testing/test-app.js';
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});
describe('guided voice setup', () => {
  it('saves only validated revision-checked configuration and rejects generic settings bypass', async () => {
    const initial = await t.app.inject({ method: 'GET', url: '/chat/voice/config' });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.json().route.ready).toBe(false);
    const body = {
      expectedRevision: 0,
      enabled: true,
      mode: 'cloud',
      cloudFallbackAllowed: false,
      cloud: {
        provider: 'openai',
        model: 'gpt-transcribe',
        secretName: 'voice.openai.transcription',
      },
    };
    expect(
      (await t.app.inject({ method: 'PUT', url: '/chat/voice/config', payload: body })).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: 'PUT', url: '/chat/voice/config', payload: body })).statusCode,
    ).toBe(409);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: '/settings',
          payload: { [VOICE_CONFIG_KEY]: { enabled: true } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: '/chat/voice/config',
          payload: {
            ...body,
            expectedRevision: 1,
            cloud: { ...body.cloud, secretName: 'inference.openai' },
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('previews without a mutation, stages only matching configuration/draft/preview, and never publishes', async () => {
    const loops = await t.app.inject({ method: 'GET', url: '/chat/voice/loops' });
    const item = loops.json().items[0];
    expect(item.classification).toBe('standard');
    const body = {
      loopId: item.loopId,
      expectedDraftHash: item.definitionHash,
      expectedConfigRevision: 0,
    };
    VoicePreviewSchema.parse(
      await t.container.voice.preview('local', item.loopId, item.definitionHash, 0),
    );
    const preview = await t.app.inject({
      method: 'POST',
      url: '/chat/voice/preview',
      payload: body,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(
      VoicePreviewSchema.parse(preview.json()).definition.nodes.some(
        (node) => node.kind === 'script' && node.config.command === VOICE_NORMALIZER_COMMAND,
      ),
    ).toBe(true);
    expect((await t.container.repos.loops.getLoop(item.loopId))?.draftVersionId).toBeUndefined();
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/voice/stage',
          payload: { ...body, expectedPreviewHash: '0'.repeat(16) },
        })
      ).statusCode,
    ).toBe(409);
    const before = await t.container.repos.loops.getLoop(item.loopId);
    const staged = await t.app.inject({
      method: 'POST',
      url: '/chat/voice/stage',
      payload: { ...body, expectedPreviewHash: preview.json().previewHash },
    });
    expect(staged.statusCode, staged.body).toBe(200);
    expect(staged.json().editorUrl).toBe(`/app/loops/${item.loopId}/edit`);
    const after = await t.container.repos.loops.getLoop(item.loopId);
    expect(after?.currentVersionId).toBe(before?.currentVersionId);
    expect(after?.draftVersionId).toBeTruthy();
    const draft = await t.container.repos.loops.getVersion(after!.draftVersionId!);
    expect(stableHash(draft!.definition)).toBe(staged.json().draftHash);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/voice/stage',
          payload: { ...body, expectedPreviewHash: preview.json().previewHash },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('deduplicates explicit probes and recovers acknowledgement with reads only', async () => {
    const probe = vi.spyOn(t.container.voice, 'probe').mockResolvedValue({
      route: 'cloud',
      configRevision: 0,
      checkedAt: new Date().toISOString(),
      fingerprint: 'safe',
      suitable: true,
      latencyMs: 10,
      freeMemoryBytes: 1e9,
      message: 'Sample passed',
      transcript: 'Public sample',
    });
    const body = {
      operationId: randomUUID(),
      route: 'cloud',
      expectedConfigRevision: 0,
      cloudUploadAcknowledged: true,
    };
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/voice/probe',
          payload: { ...body, cloudUploadAcknowledged: false },
        })
      ).statusCode,
    ).toBe(400);
    const start = await t.app.inject({ method: 'POST', url: '/chat/voice/probe', payload: body });
    expect(start.statusCode).toBe(202);
    await vi.waitFor(async () =>
      expect(
        (await t.app.inject({ url: `/chat/voice/probes/${body.operationId}` })).json().state,
      ).toBe('succeeded'),
    );
    await t.app.inject({ method: 'POST', url: '/chat/voice/probe', payload: body });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/voice/probe',
          payload: { ...body, route: 'local' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await t.app.inject({ url: `/chat/voice/installs/${body.operationId}` })).statusCode,
    ).toBe(404);
  });
});

describe('normalization stays inside the native loop', () => {
  it('passes text through a published preset without a transcriber or cloud credential', async () => {
    const [item] = await t.container.voice.loops('local');
    const preview = await t.container.voice.preview('local', item!.loopId, item!.definitionHash, 0);
    await t.container.repos.loops.saveDraft(item!.loopId, preview.definition);
    await t.container.repos.loops.publish(item!.loopId, preview.definition);
    t.harness.script([{ finalText: 'Text still works' }]);
    const conversation = await t.container.repos.chat.createConversation({
      ownerId: 'local',
      audienceKey: 'gateway',
    });
    const turn = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversation.id}/turns`,
      payload: { requestId: randomUUID(), input: { kind: 'text', text: 'No cloud secret needed' } },
    });
    expect(turn.statusCode, turn.body).toBe(202);
    await t.idle();
    const response = await t.app.inject({ url: `/chat/turns/${turn.json().id}` });
    expect(response.json()).toMatchObject({
      runStatus: 'succeeded',
      response: { reply: 'Text still works' },
    });
    expect((await t.app.inject({ url: '/chat/session' })).json().readiness).toMatchObject({
      text: { ready: true },
      audio: { ready: false },
    });
  });
  it('labels custom prompts as customized and refuses to overwrite custom normalizers', async () => {
    const [item] = await t.container.voice.loops('local');
    const loop = await t.container.repos.loops.getLoop(item!.loopId);
    const version = await t.container.repos.loops.getVersion(loop!.currentVersionId!);
    const definition = structuredClone(version!.definition);
    const respond = definition.nodes.find((node) => node.id === 'respond');
    if (respond?.kind === 'inference')
      respond.config.prompt.template = 'An authored custom instruction';
    await t.container.repos.loops.saveDraft(loop!.id, definition);
    expect((await t.container.voice.loops('local'))[0]?.classification).toBe('customized');
    await expect(
      t.container.voice.preview('local', loop!.id, stableHash(definition), 0),
    ).rejects.toMatchObject({ code: 'VOICE_PRESET_PROMPT_UNSUPPORTED' });
    await t.container.repos.loops.saveDraft(loop!.id, version!.definition);
    const preview = await t.container.voice.preview(
      'local',
      loop!.id,
      stableHash(version!.definition),
      0,
    );
    const normalizer = preview.definition.nodes.find((node) => node.id === 'chat-normalize');
    if (normalizer?.kind === 'script') normalizer.config.command = 'my-authored-transcriber';
    await t.container.repos.loops.saveDraft(loop!.id, preview.definition);
    await expect(
      t.container.voice.preview('local', loop!.id, stableHash(preview.definition), 0),
    ).rejects.toMatchObject({ code: 'VOICE_CUSTOM_NORMALIZER' });
    expect(
      (await t.container.repos.loops.getVersion(
        (await t.container.repos.loops.getLoop(loop!.id))!.draftVersionId!,
      ))!.definition,
    ).toEqual(preview.definition);
  });
});

describe('pinned local transcription', () => {
  it('combines caption and transcript, records local route, and recovers the same upload without writing again', async () => {
    const executable = join(t.dataDir, 'fake-whisper');
    const modelPath = join(t.dataDir, 'tiny.bin');
    await writeFile(executable, 'fixture', { mode: 0o700 });
    await writeFile(modelPath, 'model');
    const success: ScriptRunResult = {
      state: 'completed',
      exitCode: 0,
      stdout: 'My fellow Americans ask what your country can do',
      stderr: '',
      stdoutBytes: 31,
      stderrBytes: 0,
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
    const runner = { run: vi.fn().mockResolvedValue(success) };
    const fetcher = vi.fn<typeof fetch>();
    const voice = new VoiceService(t.container, runner, fetcher, {
      freeMemoryBytes: () => 64 * 1024 ** 2,
      inspectModel: () =>
        Promise.resolve({
          qualified: true,
          message: 'fixture',
          fingerprint: 'model-fixture',
        }),
    });
    t.container.voice = voice;
    t.container.ports.scripts = new VoiceScripts(runner, voice);
    vi.spyOn(voice.installer, 'inspect').mockResolvedValue({
      qualified: true,
      message: 'fixture',
      fingerprint: 'runtime-fixture',
    });
    await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'auto',
      cloudFallbackAllowed: true,
      local: { executable, modelPath },
      cloud: {
        provider: 'openai',
        model: 'gpt-transcribe',
        secretName: 'voice.openai.transcription',
      },
    });
    const localProbe = await voice.probe('local', 'local', 1);
    expect(localProbe.suitable, JSON.stringify(localProbe)).toBe(true);
    expect((await voice.route('local')).route).toBe('local');
    const [item] = await voice.loops('local');
    const preview = await voice.preview('local', item!.loopId, item!.definitionHash, 1);
    await t.container.repos.loops.saveDraft(item!.loopId, preview.definition);
    await t.container.repos.loops.publish(item!.loopId, preview.definition);
    const routeReads = vi.spyOn(voice, 'route');
    await t.app.inject({ url: '/chat/session' });
    expect(routeReads).toHaveBeenCalledTimes(1);
    routeReads.mockClear();
    const wav = voiceProbeSample();
    const uploadId = randomUUID();
    const headers = {
      'content-type': 'audio/wav',
      'idempotency-key': uploadId,
      'x-content-sha256': createHash('sha256').update(wav).digest('hex'),
    };
    const upload = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers,
      payload: wav,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const duplicate = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers,
      payload: wav,
    });
    expect(duplicate.json()).toEqual(upload.json());
    expect((await t.app.inject({ url: `/chat/audio/requests/${uploadId}` })).json()).toEqual({
      state: 'ready',
      audio: upload.json(),
    });
    const conversation = await t.container.repos.chat.createConversation({
      ownerId: 'local',
      audienceKey: 'gateway',
    });
    t.harness.script([{ finalText: 'I heard both' }]);
    const admitted = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversation.id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: upload.json().id, caption: '  Typed context  ' },
      },
    });
    expect(admitted.statusCode, admitted.body).toBe(202);
    await t.idle();
    const turn = (await t.app.inject({ url: `/chat/turns/${admitted.json().id}` })).json();
    expect(turn).toMatchObject({
      runStatus: 'succeeded',
      inputTranscript: '  Typed context  \n\nMy fellow Americans ask what your country can do',
      voice: { route: 'local' },
      response: { reply: 'I heard both' },
    });
    expect(fetcher).not.toHaveBeenCalled();
    const changed = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers: { ...headers, 'x-content-sha256': 'b'.repeat(64) },
      payload: wav,
    });
    expect(changed.statusCode).toBe(409);
    runner.run.mockResolvedValueOnce({ ...success, exitCode: 1, stdout: '' });
    const failedUpload = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: wav,
    });
    expect(failedUpload.statusCode).toBe(201);
    const failedTurn = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversation.id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: failedUpload.json().id },
      },
    });
    await t.idle();
    expect(
      (await t.app.inject({ url: `/chat/turns/${failedTurn.json().id}` })).json(),
    ).toMatchObject({
      runStatus: 'failed',
      voice: { route: 'local' },
      error: { code: 'VOICE_LOCAL_FAILED' },
    });
    expect((await voice.route('local')).ready).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(t.harness.started).toHaveLength(1);
    expect((await voice.probe('local', 'local', 1)).suitable).toBe(true);
    const oversizedUpload = await t.app.inject({
      method: 'POST',
      url: '/chat/audio',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: wav,
    });
    const oversizedTurn = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversation.id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: oversizedUpload.json().id, caption: 'x'.repeat(16000) },
      },
    });
    await t.idle();
    expect(
      (await t.app.inject({ url: `/chat/turns/${oversizedTurn.json().id}` })).json(),
    ).toMatchObject({ runStatus: 'failed', error: { code: 'VOICE_NORMALIZATION_FAILED' } });
    expect(t.harness.started).toHaveLength(1);
    expect((await voice.route('local')).ready).toBe(true);
    const nativeCases = [
      {
        state: 'completed' as const,
        exitCode: 0,
        stdout: '',
        error: 'VOICE_NO_SPEECH',
        quarantine: false,
      },
      {
        state: 'outcome-uncertain' as const,
        exitCode: null,
        terminationUnconfirmed: true,
        stdout: 'PRIVATE',
        error: 'SCRIPT_TERMINATION_UNCONFIRMED',
        quarantine: true,
      },
      {
        state: 'outcome-uncertain' as const,
        exitCode: null,
        stdout: 'PRIVATE',
        error: 'SCRIPT_OUTCOME_UNCERTAIN',
        quarantine: true,
      },
    ];
    for (const fixture of nativeCases) {
      if (!(await voice.route('local')).ready) await voice.probe('local', 'local', 1);
      runner.run.mockResolvedValueOnce({ ...success, ...fixture });
      const id = await t.container.repos.chat.reserveAudio({
        ownerId: 'local',
        audienceKey: 'gateway',
      });
      const bytes = await t.container.chatAudio.write(id, wav);
      await t.container.repos.chat.completeAudio({ ownerId: 'local', audienceKey: 'gateway' }, id, {
        mimeType: 'audio/wav',
        bytes: bytes.byteLength,
        sha256: bytes.sha256,
        path: bytes.path,
      });
      const accepted = await t.app.inject({
        method: 'POST',
        url: `/chat/conversations/${conversation.id}/turns`,
        payload: { requestId: randomUUID(), input: { kind: 'audio', audioId: id } },
      });
      expect(accepted.statusCode, accepted.body).toBe(202);
      await t.idle();
      const result = (await t.app.inject({ url: `/chat/turns/${accepted.json().id}` })).json();
      expect(result).toMatchObject({ runStatus: 'failed', error: { code: fixture.error } });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      if (fixture.error === 'SCRIPT_TERMINATION_UNCONFIRMED')
        expect((await t.container.repos.runs.get(result.runId))?.failure?.resumable).toBe(false);
      expect((await voice.route('local')).ready).toBe(!fixture.quarantine);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});

describe('cloud connection and management isolation', () => {
  it('uses the dedicated encrypted credential, redacts diagnostics and invalidates qualification after replacement', async () => {
    const runner = { run: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: 'My fellow Americans ask what your country can do' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const voice = new VoiceService(t.container, runner, fetcher);
    t.container.voice = voice;
    await t.container.repos
      .secretsFor('local')
      .set('voice.openai.transcription', 'PRIVATE_CLOUD_KEY');
    await voice.update('local', {
      expectedRevision: 0,
      enabled: true,
      mode: 'cloud',
      cloudFallbackAllowed: false,
      cloud: {
        provider: 'openai',
        model: 'gpt-transcribe',
        secretName: 'voice.openai.transcription',
      },
    });
    const measured = await voice.probe('local', 'cloud', 1, true);
    expect(measured.suitable).toBe(true);
    expect((await voice.route('local')).route).toBe('cloud');
    expect(JSON.stringify(await voice.setup('local'))).not.toContain('PRIVATE_CLOUD_KEY');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer PRIVATE_CLOUD_KEY',
    });
    await t.container.repos
      .secretsFor('local')
      .set('voice.openai.transcription', 'REPLACED_PRIVATE_KEY');
    expect((await voice.route('local')).ready).toBe(false);
    fetcher.mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR', { status: 401 }));
    const failed = await voice.probe('local', 'cloud', 1, true);
    expect(failed.suitable).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_ERROR');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(runner.run).not.toHaveBeenCalled();
  });
  it('denies every setup route to devices while allowing scoped read-only upload recovery', async () => {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    vi.spyOn(t.container.repos.chat, 'authenticateDevice').mockResolvedValue({
      ownerId: 'local',
      device: { id, label: 'Phone', loopId: id, createdAt: new Date().toISOString() },
    });
    const headers = { authorization: `Bearer ggd_${'A'.repeat(43)}` };
    const endpoints: [string, string][] = [
      ['GET', '/chat/voice/config'],
      ['PUT', '/chat/voice/config'],
      ['POST', '/chat/voice/probe'],
      ['POST', '/chat/voice/install'],
      ['GET', '/chat/voice/loops'],
      ['POST', '/chat/voice/preview'],
      ['POST', '/chat/voice/stage'],
      ['GET', `/chat/voice/probes/${randomUUID()}`],
      ['GET', `/chat/voice/installs/${randomUUID()}`],
    ];
    for (const [method, url] of endpoints) {
      const response = await t.app.inject({
        method: method as 'GET' | 'PUT' | 'POST',
        url,
        headers,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(
      (await t.app.inject({ url: `/chat/audio/requests/${randomUUID()}`, headers })).statusCode,
    ).toBe(404);
  });
  it('treats persisted interrupted operations as terminal and never reruns them on GET', async () => {
    const id = randomUUID();
    await t.container.repos.settings.beginVoiceOperation('local', id, {
      hash: 'fixture',
      result: { operationId: id, kind: 'probe', state: 'running' },
    });
    const probe = vi.spyOn(t.container.voice, 'probe');
    expect(await t.container.voice.operation('local', id, 'probe')).toMatchObject({
      state: 'failed',
      code: 'VOICE_OPERATION_INTERRUPTED',
    });
    expect(await t.container.voice.operation('local', id, 'probe')).toMatchObject({
      state: 'failed',
    });
    expect(probe).not.toHaveBeenCalled();
    await expect(t.container.voice.operation('another-owner', id, 'probe')).rejects.toMatchObject({
      code: 'CHAT_NOT_FOUND',
    });
  });
});

it('serializes model installations across distinct identities and exposes read-only progress', async () => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const install = vi.spyOn(t.container.voice.installer, 'start').mockImplementation(async () => {
    t.container.voice.installer.progress = {
      state: 'installing',
      phase: 'Downloading fixture',
      downloadedBytes: 7,
      totalBytes: 10,
    };
    await started;
    t.container.voice.installer.progress = {
      state: 'ready',
      phase: 'Fixture ready',
      downloadedBytes: 10,
      totalBytes: 10,
    };
  });
  const first = {
    operationId: randomUUID(),
    expectedConfigRevision: 0,
    modelId: 'tiny.en' as const,
  };
  await t.container.voice.startInstall('local', first);
  await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  expect(await t.container.voice.operation('local', first.operationId, 'install')).toMatchObject({
    state: 'running',
    install: { downloadedBytes: 7, totalBytes: 10 },
  });
  const second = { ...first, operationId: randomUUID(), modelId: 'base.en' as const };
  await t.container.voice.startInstall('local', second);
  await vi.waitFor(async () =>
    expect(await t.container.voice.operation('local', second.operationId, 'install')).toMatchObject(
      { state: 'failed', code: 'VOICE_INSTALL_BUSY' },
    ),
  );
  release();
  await vi.waitFor(async () =>
    expect(await t.container.voice.operation('local', first.operationId, 'install')).toMatchObject({
      state: 'succeeded',
    }),
  );
  expect(install).toHaveBeenCalledTimes(1);
});

it('reserves generic voice deletion and keeps setup metadata outside ordinary settings', async () => {
  await t.container.repos.settings.set('local', 'chat.voice.route.fixture', {
    private: 'owner metadata',
  });
  expect(
    (await t.app.inject({ method: 'DELETE', url: '/settings/chat.voice.v1' })).json(),
  ).toMatchObject({ code: 'VOICE_SETTING_RESERVED' });
  expect((await t.app.inject({ url: '/settings' })).body).not.toContain('chat.voice.');
  const response = await t.app.inject({
    method: 'PUT',
    url: '/settings',
    payload: { ordinary: true },
  });
  expect(response.body).not.toContain('chat.voice.');
});

it('rejects incidental sample substrings and unrelated word matches', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const voice = new VoiceService(t.container, { run: vi.fn() }, fetcher);
  await t.container.repos.secretsFor('local').set('voice.openai.transcription', 'test-key');
  await voice.update('local', {
    expectedRevision: 0,
    enabled: true,
    mode: 'cloud',
    cloudFallbackAllowed: false,
    cloud: {
      provider: 'openai',
      model: 'gpt-transcribe',
      secretName: 'voice.openai.transcription',
    },
  });
  for (const text of [
    'Task basket Alaska',
    'My country is beautiful',
    'Ask your country',
    'My fellow Americans ask what your country can do',
  ]) {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ text })));
    const result = await voice.probe('local', 'cloud', 1, true);
    expect(result.suitable).toBe(text.startsWith('My fellow Americans'));
  }
});

it('preserves noncanonical custom WAV while the guided preset rejects the same bytes', async () => {
  const [item] = await t.container.voice.loops('local');
  const preview = await t.container.voice.preview('local', item!.loopId, item!.definitionHash, 0);
  const custom = structuredClone(preview.definition);
  const node = custom.nodes.find((node) => node.id === 'chat-normalize');
  if (node?.kind === 'script') node.config.command = 'custom-transcriber';
  await t.container.repos.loops.saveDraft(item!.loopId, custom);
  await t.container.repos.loops.publish(item!.loopId, custom);
  const wav = voiceProbeSample();
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  const makeHeaders = () => ({
    'content-type': 'audio/wav',
    'idempotency-key': randomUUID(),
    'x-content-sha256': createHash('sha256').update(wav).digest('hex'),
  });
  const accepted = await t.app.inject({
    method: 'POST',
    url: '/chat/audio',
    headers: makeHeaders(),
    payload: wav,
  });
  expect(accepted.statusCode, accepted.body).toBe(201);
  expect((await t.app.inject({ url: '/chat/session' })).json().readiness.audio.message).toContain(
    'typed captions',
  );
  await t.container.repos.loops.saveDraft(item!.loopId, preview.definition);
  await t.container.repos.loops.publish(item!.loopId, preview.definition);
  vi.spyOn(t.container.voice, 'route').mockResolvedValue({
    ready: true,
    route: 'local',
    cloudFallbackAllowed: false,
    message: 'fixture',
  });
  const refused = await t.app.inject({
    method: 'POST',
    url: '/chat/audio',
    headers: makeHeaders(),
    payload: wav,
  });
  expect(refused.json()).toMatchObject({ code: 'CHAT_AUDIO_INVALID_WAV' });
});

it('refuses legacy raw-input prompts and accepts explicitly normalized custom prompts without overwriting them', async () => {
  const [item] = await t.container.voice.loops('local');
  const loop = await t.container.repos.loops.getLoop(item!.loopId);
  const version = await t.container.repos.loops.getVersion(loop!.currentVersionId!);
  const definition = structuredClone(version!.definition);
  const node = definition.nodes.find((node) => node.id === 'respond');
  if (node?.kind !== 'inference') throw new Error('fixture');
  node.config.prompt.template =
    'Reply using {{ trigger.payload.input.text }} with the old structured envelope.';
  await t.container.repos.loops.saveDraft(item!.loopId, definition);
  await expect(
    t.container.voice.preview('local', item!.loopId, stableHash(definition), 0),
  ).rejects.toMatchObject({ code: 'VOICE_PRESET_PROMPT_UNSUPPORTED' });
  node.config.prompt.template =
    "Keep my instructions. User: {{ outputs['chat-normalize'].value.text }}";
  await t.container.repos.loops.saveDraft(item!.loopId, definition);
  const preview = await t.container.voice.preview('local', item!.loopId, stableHash(definition), 0);
  const saved = preview.definition.nodes.find((value) => value.id === 'respond');
  expect(saved?.kind === 'inference' ? saved.config.prompt.template : undefined).toBe(
    node.config.prompt.template,
  );
});
