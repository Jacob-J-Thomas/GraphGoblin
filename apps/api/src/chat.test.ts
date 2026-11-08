import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_PROTOCOL,
  LoopDefinitionSchema,
  type ChatConversation,
  type ChatDevice,
  type ChatPairingCreated,
  type ChatSession,
  type ChatTurn,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio, readinessFailure } from '@graphgoblin/domain';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { pairingBaseUrl } from './routes/chat.js';
import { normalizeChatMediaType } from './chat/media.js';
import { ChatAudioStoreError } from '@graphgoblin/infrastructure/fs';

let t: TestApp;
afterEach(async () => {
  await t?.close();
  vi.restoreAllMocks();
});
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const response = (reply: string) => ({ protocol: CHAT_PROTOCOL, reply });
function uploadAudio(payload: Buffer, contentType: string) {
  return t.app.inject({
    method: 'POST',
    url: '/chat/audio',
    headers: {
      'content-type': contentType,
      'idempotency-key': randomUUID(),
      'x-content-sha256': createHash('sha256').update(payload).digest('hex'),
    },
    payload,
  });
}
function canonicalWav(): Buffer {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40);
  bytes.writeInt16LE(1024, 44);
  return bytes;
}
async function conversation(token?: string): Promise<string> {
  const result = await t.app.inject({
    method: 'POST',
    url: '/chat/conversations',
    payload: {},
    ...(token ? { headers: headers(token) } : {}),
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json<ChatConversation>().id;
}
async function send(id: string, text = 'Hello', requestId = randomUUID(), token?: string) {
  return t.app.inject({
    method: 'POST',
    url: `/chat/conversations/${id}/turns`,
    payload: { requestId, input: { kind: 'text', text } },
    ...(token ? { headers: headers(token) } : {}),
  });
}
async function gateway() {
  const binding = await t.container.repos.chat.getBinding({
    ownerId: 'local',
    audienceKey: 'gateway',
  });
  expect(binding).toBeDefined();
  return binding!.loopId;
}
async function pair(ownerToken: string, label = 'Desk') {
  const created = await t.app.inject({
    method: 'POST',
    url: '/chat/pairings',
    headers: headers(ownerToken),
    payload: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  const pairing = created.json<ChatPairingCreated>();
  const token = `ggd_${randomBytes(32).toString('base64url')}`;
  const claim = { code: pairing.code, claimId: randomUUID(), deviceToken: token, label };
  const claimed = await t.app.inject({
    method: 'POST',
    url: '/chat/pairings/claim',
    payload: claim,
  });
  expect(claimed.statusCode, claimed.body).toBe(200);
  return { pairing, token, claim, device: claimed.json<{ deviceId: string; label: string }>() };
}
async function audioDefinition(invalid = false) {
  const id = await gateway();
  const def = enableChatAudio(
    createSystemChatDefinition({ name: 'Audio chat', harness: 'codex' }),
    {
      id: 'chat-normalize',
      kind: 'script',
      label: 'Normalize',
      ui: { x: 160, y: 0 },
      config: {
        command: process.execPath,
        args: [
          '-e',
          `let body='';process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>{const t=JSON.parse(body),i=t.invocation.trigger.payload.input;console.log(JSON.stringify(${invalid ? '{bad:true}' : "{text:i.kind==='text'?i.text:require('node:fs').readFileSync(i.audio.path,'utf8')}"}));});`,
        ],
        cwd: 'workspace',
        stdin: 'thread',
        stdout: 'last-output',
      },
    },
  );
  expect(
    (
      await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition: LoopDefinitionSchema.parse(def) },
      })
    ).statusCode,
  ).toBe(200);
  const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
  expect(published.statusCode, published.body).toBe(200);
  return id;
}

describe('native workflow chat', () => {
  it('seeds one real published loop, admits once, and returns the exact native response and history', async () => {
    t = await createTestApp();
    const loopId = await gateway();
    expect((await t.container.repos.loops.getLoop(loopId))?.system?.audience).toEqual({
      kind: 'gateway',
    });
    const session = await t.app.inject('/chat/session');
    expect(session.json<ChatSession>()).toMatchObject({
      systemLoopId: loopId,
      readiness: { text: { ready: true }, audio: { ready: false, code: 'CHAT_AUDIO_UNAVAILABLE' } },
    });
    expect(session.headers['cache-control']).toBe('no-store');
    const id = await conversation();
    t.harness.script([{ finalText: 'Exact native reply' }, { finalText: 'Second actual reply' }]);
    const requestId = randomUUID();
    const [first, concurrent] = await Promise.all([
      send(id, 'Hello', requestId),
      send(id, 'Hello', requestId),
    ]);
    expect(first.statusCode, first.body).toBe(202);
    expect(concurrent.statusCode, concurrent.body).toBe(202);
    expect(first.json<ChatTurn>().id).toBe(concurrent.json<ChatTurn>().id);
    await t.idle();
    const turn = first.json<ChatTurn>();
    const recovered = await t.app.inject(`/chat/conversations/${id}/requests/${requestId}`);
    expect(recovered.json<ChatTurn>()).toMatchObject({
      runId: turn.runId,
      runStatus: 'succeeded',
      response: response('Exact native reply'),
    });
    expect((await t.container.repos.runs.list({ loopId })).length).toBe(1);
    const changed = await send(id, 'different', requestId);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe('CHAT_REQUEST_CONFLICT');
    t.harness.preflightResult = readinessFailure('codex', 'auth');
    expect((await send(id, 'Hello', requestId)).statusCode).toBe(202);
    expect((await send(id, 'new turn')).json().code).toBe('CHAT_NOT_READY');
    t.harness.preflightResult = { state: 'ready', ok: true, authenticated: true, problems: [] };
    const second = await send(id, 'Another');
    expect(second.statusCode, second.body).toBe(202);
    await t.idle();
    const thread = await t.container.manager.getThread(second.json<ChatTurn>().runId);
    expect(thread?.invocation.trigger.payload).toMatchObject({
      history: [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Exact native reply' },
      ],
    });
    expect(
      (await t.app.inject(`/chat/conversations/${id}/turns?after=1&limit=1`)).json().items,
    ).toHaveLength(1);
    expect((await t.app.inject('/chat/conversations?limit=1')).json().items).toHaveLength(1);
    expect((await t.app.inject(`/chat/turns/${turn.id}`)).statusCode).toBe(200);
    expect(
      (await t.app.inject(`/chat/conversations/${id}/requests/${randomUUID()}`)).statusCode,
    ).toBe(404);
  });

  it('rejects boundary saves/deletion while preserving interior edits and ordinary imports', async () => {
    t = await createTestApp();
    const loopId = await gateway();
    const def = createSystemChatDefinition({ name: 'Edited gateway', harness: 'codex' });
    const invalid = structuredClone(def);
    invalid.nodes = invalid.nodes.filter((node) => node.id !== 'chat-input');
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${loopId}/draft`,
      payload: { definition: invalid },
    });
    expect(saved.json().code).toBe('SYSTEM_CHAT_CONTRACT_INVALID');
    const validated = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/validate`,
      payload: { definition: invalid },
    });
    expect(validated.json().publishable).toBe(false);
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).json().code).toBe(
      'SYSTEM_LOOP_PROTECTED',
    );
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${loopId}/draft`,
          payload: { definition: def },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode,
    ).toBe(200);
    const incomplete = structuredClone(def);
    const exit = incomplete.nodes.find((node) => node.kind === 'exit');
    if (exit?.kind === 'exit') exit.config.returns = 'none';
    const incompleteSave = await t.app.inject({
      method: 'PUT',
      url: `/loops/${loopId}/draft`,
      payload: { definition: incomplete },
    });
    expect(incompleteSave.statusCode, incompleteSave.body).toBe(200);
    expect(incompleteSave.json().issues).toContainEqual(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).json().code,
    ).toBe('SYSTEM_CHAT_CONTRACT_INVALID');
    const direct = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {
        allowDraft: true,
        versionId: incompleteSave.json<{ draft: { id: string } }>().draft.id,
        input: {
          protocol: CHAT_PROTOCOL,
          conversationId: t.container.ports.ids.next(),
          requestId: randomUUID(),
          turn: 1,
          input: { kind: 'text', text: 'must remain guarded' },
          history: [],
        },
      },
    });
    expect(direct.statusCode, direct.body).toBe(409);
    expect(direct.json().code).toBe('CHAT_NOT_READY');
    const imported = await t.app.inject({ method: 'POST', url: '/loops/import', payload: def });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().loop.system).toBeUndefined();
    const before = await t.container.repos.loops.listLoops('local');
    await t.container.repos.chat.ensureGateway('local', def);
    expect(await t.container.repos.loops.listLoops('local')).toHaveLength(before.length);
  });

  it('reports setup/readiness honestly, rejects target overrides, and bounds unknown object access', async () => {
    t = await createTestApp();
    t.harness.preflightResult = readinessFailure('codex', 'cli-missing');
    expect((await t.app.inject('/chat/session')).json().readiness.text.ready).toBe(false);
    const id = await conversation();
    const refused = await send(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('CHAT_NOT_READY');
    expect(await t.container.repos.runs.list({})).toHaveLength(0);
    for (const field of ['history', 'ownerId', 'loopId', 'versionId', 'caller', 'return', 'path']) {
      const result = await t.app.inject({
        method: 'POST',
        url: `/chat/conversations/${id}/turns`,
        payload: {
          requestId: randomUUID(),
          input: { kind: 'text', text: 'hi' },
          [field]: 'forged',
        },
      });
      expect(result.statusCode, field).toBe(400);
    }
    const unknown = t.container.ports.ids.next();
    for (const url of [`/chat/conversations/${unknown}/turns`, `/chat/turns/${unknown}`])
      expect((await t.app.inject(url)).statusCode).toBe(404);
    expect((await send(unknown)).statusCode).toBe(404);
    const missingCancel = await t.app.inject({
      method: 'POST',
      url: `/chat/turns/${unknown}/cancel`,
      payload: {},
    });
    expect(missingCancel.statusCode).toBe(404);
    const upload = await uploadAudio(Buffer.from('bytes'), 'audio/webm');
    expect(upload.json().code).toBe('CHAT_AUDIO_UNAVAILABLE');
    expect(
      (await t.app.inject({ method: 'POST', url: '/chat/pairings', payload: {} })).json().code,
    ).toBe('CHAT_PAIRING_UNAVAILABLE');
  });

  it('keeps active turns single-file and cancels only through native run commands', async () => {
    t = await createTestApp();
    t.harness.script([{ finalText: 'late', delayMs: 2000 }]);
    const id = await conversation();
    const first = await send(id);
    const active = first.json<ChatTurn>();
    expect((await send(id, 'parallel')).json().code).toBe('CHAT_BUSY');
    const cancelled = await t.app.inject({
      method: 'POST',
      url: `/chat/turns/${active.id}/cancel`,
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    await t.idle();
    expect((await t.app.inject(`/chat/turns/${active.id}`)).json().runStatus).toBe('cancelled');
  });
});

describe('isolated device authorization and enrollment', () => {
  it('clones once per claim, separates audiences, protects management, and revokes every request', async () => {
    t = await createTestApp({
      requireApiKey: true,
      env: { GG_PUBLIC_URL: 'https://goblin.example' },
    });
    const owner = await t.container.repos.apiKeys.create('local', 'owner', ['*']);
    const a = await pair(owner.token, 'Kitchen');
    const b = await pair(owner.token, 'Desk');
    expect(a.pairing.url).toBe(`https://goblin.example/goblin/#pair=${a.pairing.code}`);
    expect(a.pairing.url).not.toContain('?');
    const duplicate = await t.app.inject({
      method: 'POST',
      url: '/chat/pairings/claim',
      payload: { ...a.claim, label: 'Retry cannot rename the device' },
    });
    expect(duplicate.json()).toEqual(a.device);
    const mismatch = await t.app.inject({
      method: 'POST',
      url: '/chat/pairings/claim',
      payload: { ...a.claim, claimId: randomUUID() },
    });
    expect(mismatch.statusCode).toBe(401);
    const aSession = await t.app.inject({ url: '/chat/session', headers: headers(a.token) });
    expect(aSession.json<ChatSession>()).toMatchObject({
      audience: { kind: 'device', deviceId: a.device.deviceId },
      label: 'Kitchen',
    });
    expect(aSession.body).not.toContain('systemLoopId');
    const aConversation = await conversation(a.token);
    const bConversation = await conversation(b.token);
    expect(aConversation).not.toBe(bConversation);
    t.harness.script([{ finalText: 'For Kitchen only' }]);
    const sent = await send(aConversation, 'kitchen', randomUUID(), a.token);
    expect(sent.statusCode, sent.body).toBe(202);
    await t.idle();
    const turn = sent.json<ChatTurn>();
    for (const url of [
      '/loops',
      '/runs',
      '/settings',
      '/api-keys',
      '/chat/devices',
      '/chat/voice/config',
      '/chat/voice/loops',
      `/chat/voice/probes/${randomUUID()}`,
      `/chat/voice/installs/${randomUUID()}`,
      '/chat/unknown',
      '/healthz',
    ]) {
      const result = await t.app.inject({ url, headers: headers(a.token) });
      expect(result.statusCode, url).toBe(403);
    }
    for (const [method, url] of [
      ['PUT', '/chat/voice/config'],
      ['POST', '/chat/voice/probe'],
      ['POST', '/chat/voice/install'],
      ['POST', '/chat/voice/preview'],
      ['POST', '/chat/voice/stage'],
    ] as const) {
      const result = await t.app.inject({ method, url, payload: {}, headers: headers(a.token) });
      expect(result.statusCode, `${method} ${url}`).toBe(403);
    }
    for (const url of [
      `/chat/conversations/${aConversation}/turns`,
      `/chat/turns/${turn.id}`,
      `/chat/conversations/${aConversation}/requests/${turn.requestId}`,
    ]) {
      expect((await t.app.inject({ url, headers: headers(b.token) })).statusCode).toBe(404);
    }
    expect((await send(aConversation, 'foreign', randomUUID(), b.token)).statusCode).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/chat/turns/${turn.id}/cancel`,
          payload: {},
          headers: headers(b.token),
        })
      ).statusCode,
    ).toBe(404);
    const list = await t.app.inject({ url: '/chat/devices', headers: headers(owner.token) });
    expect(list.json().items).toHaveLength(2);
    expect(list.body).not.toMatch(/ggd_|tokenHash|codeHash/);
    const devices = list.json<{ items: ChatDevice[] }>().items;
    expect(new Set(devices.map((device) => device.loopId)).size).toBe(2);
    const deviceVersions = await Promise.all(
      devices.map(async (device) => {
        const loop = (await t.container.repos.loops.getLoop(device.loopId))!;
        expect(loop.system?.audience).toEqual({ kind: 'device', deviceId: device.id });
        const version = (await t.container.repos.loops.getVersion(loop.currentVersionId!))!;
        expect(version.status).toBe('published');
        return version.id;
      }),
    );
    const gatewayId = await gateway();
    const gatewayDefinition = createSystemChatDefinition({
      name: 'Changed after pairing',
      harness: 'codex',
    });
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${gatewayId}/draft`,
          headers: headers(owner.token),
          payload: { definition: gatewayDefinition },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/loops/${gatewayId}/publish`,
          headers: headers(owner.token),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await Promise.all(
        devices.map(
          async (device) =>
            (await t.container.repos.loops.getLoop(device.loopId))!.currentVersionId,
        ),
      ),
    ).toEqual(deviceVersions);
    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/chat/devices/${a.device.deviceId}`,
      payload: { label: 'Living room' },
      headers: headers(owner.token),
    });
    expect(renamed.json().label).toBe('Living room');
    for (let i = 0; i < 2; i++)
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: `/chat/devices/${a.device.deviceId}/revoke`,
            payload: {},
            headers: headers(owner.token),
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (await t.app.inject({ url: '/chat/session', headers: headers(a.token) })).statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ method: 'POST', url: '/chat/pairings/claim', payload: a.claim }))
        .statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ url: '/chat/devices', headers: headers(owner.token) })).json().items,
    ).toHaveLength(2);
    expect(
      (await t.app.inject({ url: `/chat/turns/${turn.id}`, headers: headers(owner.token) }))
        .statusCode,
    ).toBe(404);
  });

  it('enforces chat scopes, wildcard enrollment, secure URL prerequisites, exact public mutation and rate limits', async () => {
    t = await createTestApp({
      requireApiKey: true,
      env: { GG_PUBLIC_URL: 'http://remote.example' },
    });
    const scoped = await t.container.repos.apiKeys.create('local', 'chat', ['chat:write']);
    expect(
      (await t.app.inject({ url: '/chat/session', headers: headers(scoped.token) })).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/pairings',
          payload: {},
          headers: headers(scoped.token),
        })
      ).statusCode,
    ).toBe(403);
    const owner = await t.container.repos.apiKeys.create('local', 'owner', ['*']);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/pairings',
          payload: {},
          headers: headers(owner.token),
        })
      ).json().code,
    ).toBe('CHAT_PAIRING_UNAVAILABLE');
    expect((await t.app.inject('/chat/session')).statusCode).toBe(401);
    for (const token of ['ggd_invalid', 'ggd_' + 'A'.repeat(43), 'not-a-key'])
      expect(
        (await t.app.inject({ url: '/chat/session', headers: headers(token) })).statusCode,
      ).toBe(401);
    expect(
      (await t.app.inject({ method: 'POST', url: '/chat/pairings/other', payload: {} })).statusCode,
    ).toBe(401);
    const claim = {
      code: randomBytes(32).toString('base64url'),
      claimId: randomUUID(),
      deviceToken: `ggd_${randomBytes(32).toString('base64url')}`,
      label: 'Bad code',
    };
    for (let i = 0; i < 10; i++)
      expect(
        (await t.app.inject({ method: 'POST', url: '/chat/pairings/claim', payload: claim }))
          .statusCode,
      ).toBe(401);
    const limited = await t.app.inject({
      method: 'POST',
      url: '/chat/pairings/claim',
      payload: claim,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers['cache-control']).toBe('no-store');
  });

  it('keeps device restrictions in local trusted mode and rejects expired claims without logging credential hashes', async () => {
    t = await createTestApp({
      requireApiKey: true,
      env: { GG_PUBLIC_URL: 'http://127.0.0.1:4747' },
    });
    const owner = await t.container.repos.apiKeys.create('local', 'owner', ['*']);
    const device = await pair(owner.token);
    t.container.config.requireApiKey = false;
    expect(
      (await t.app.inject({ url: '/settings', headers: headers(device.token) })).statusCode,
    ).toBe(403);
    expect(
      (await t.app.inject({ url: '/settings', headers: headers('ggd_invalid') })).statusCode,
    ).toBe(401);
    expect(
      (
        await t.app.inject({ method: 'POST', url: '/chat/pairings/claim', payload: device.claim })
      ).json().code,
    ).toBe('CHAT_PAIRING_UNAVAILABLE');
    t.container.config.requireApiKey = true;
    t.clock.advance(10 * 60_000 + 1);
    expect(
      (await t.app.inject({ method: 'POST', url: '/chat/pairings/claim', payload: device.claim }))
        .statusCode,
    ).toBe(401);
    vi.spyOn(t.container.repos.chat, 'claimPairing').mockRejectedValue(
      new Error('PRIVATE_CREDENTIAL_HASH'),
    );
    const log = vi.spyOn(t.app.log, 'error');
    const failed = await t.app.inject({
      method: 'POST',
      url: '/chat/pairings/claim',
      payload: device.claim,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('PRIVATE_CREDENTIAL_HASH');
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_CREDENTIAL_HASH');
  });

  it('caps enrollment attempts globally across source addresses', async () => {
    t = await createTestApp({ requireApiKey: true });
    const claim = {
      code: randomBytes(32).toString('base64url'),
      claimId: randomUUID(),
      deviceToken: `ggd_${randomBytes(32).toString('base64url')}`,
      label: 'Unknown enrollment',
    };
    for (let index = 1; index <= 100; index++) {
      const result = await t.app.inject({
        method: 'POST',
        url: '/chat/pairings/claim',
        remoteAddress: `127.1.0.${index}`,
        payload: claim,
      });
      expect(result.statusCode).toBe(401);
    }
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/chat/pairings/claim',
          remoteAddress: '127.2.0.1',
          payload: claim,
        })
      ).statusCode,
    ).toBe(429);
  });
});

describe('workflow audio transport and projection', () => {
  it('preserves bytes for a real Script normalizer, exposes its actual transcript, and consumes once', async () => {
    t = await createTestApp();
    await audioDefinition();
    const session = (await t.app.inject('/chat/session')).json<ChatSession>();
    expect(session.readiness.audio).toMatchObject({
      ready: true,
      message: expect.stringContaining('typed captions'),
    });
    const bytes = Buffer.from('actual fixture transcript');
    const upload = await uploadAudio(bytes, 'audio/webm;codecs=opus');
    expect(upload.statusCode, upload.body).toBe(201);
    expect(upload.body).not.toContain('path');
    const audioId = upload.json<{ id: string }>().id;
    expect(await readFile(t.container.chatAudio.resolve(audioId))).toEqual(bytes);
    const id = await conversation();
    t.harness.script([{ finalText: 'Workflow heard the audio' }]);
    const requestId = randomUUID();
    const sent = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${id}/turns`,
      payload: { requestId, input: { kind: 'audio', audioId } },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    await t.idle();
    const turn = await t.app.inject(`/chat/turns/${sent.json<ChatTurn>().id}`);
    expect(turn.json<ChatTurn>()).toMatchObject({
      inputTranscript: 'actual fixture transcript',
      response: response('Workflow heard the audio'),
    });
    expect(turn.body).not.toContain(t.dataDir);
    t.harness.script([{ finalText: 'Typed text passed through' }]);
    const typed = await send(id, 'Typed after audio');
    expect(typed.statusCode, typed.body).toBe(202);
    await t.idle();
    const typedThread = await t.container.manager.getThread(typed.json<ChatTurn>().runId);
    expect(typedThread?.outputs['chat-normalize']?.value).toEqual({ text: 'Typed after audio' });
    expect(typedThread?.invocation.trigger.payload).toMatchObject({
      history: [
        { role: 'user', text: 'actual fixture transcript' },
        { role: 'assistant', text: 'Workflow heard the audio' },
      ],
    });
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/chat/audio/${audioId}` })).json().code,
    ).toBe('CHAT_AUDIO_CONSUMED');
    const reused = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${id}/turns`,
      payload: { requestId: randomUUID(), input: { kind: 'audio', audioId } },
    });
    expect(reused.json().code).toBe('CHAT_AUDIO_CONSUMED');
  });

  it('rejects empty/unsupported/oversized uploads, discards unused files, and reports expired/foreign IDs', async () => {
    t = await createTestApp();
    await audioDefinition();
    for (const type of [
      'application/octet-stream',
      'audio/webm; codecs=evil',
      'audio/webm;evil=x',
    ]) {
      const result = await uploadAudio(Buffer.from('x'), type);
      expect(result.json().code, result.body).toBe('CHAT_MEDIA_UNSUPPORTED');
    }
    const empty = await uploadAudio(Buffer.alloc(0), 'audio/wav');
    expect(empty.json().code).toBe('CHAT_AUDIO_EMPTY');
    const large = await uploadAudio(Buffer.alloc(10 * 1024 * 1024 + 1), 'audio/wav');
    expect(large.json().code).toBe('CHAT_AUDIO_TOO_LARGE');
    const uploaded = await uploadAudio(canonicalWav(), 'audio/x-wav');
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    expect(uploaded.json().mimeType).toBe('audio/wav');
    const audioId = uploaded.json<{ id: string }>().id;
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/chat/audio/${audioId}` })).statusCode,
    ).toBe(204);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/chat/audio/${audioId}` })).statusCode,
    ).toBe(204);
    expect(
      (await readdir(t.dataDir + '/chat-audio')).filter((name) => name.endsWith('.audio')),
    ).toHaveLength(0);
    const expired = await uploadAudio(Buffer.from('x'), 'audio/ogg');
    expect(expired.statusCode, expired.body).toBe(201);
    t.clock.advance(60 * 60_000 + 1);
    const id = await conversation();
    const sent = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: expired.json().id },
      },
    });
    expect(sent.json().code).toBe('CHAT_AUDIO_EXPIRED');
    const unknown = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: t.container.ports.ids.next() },
      },
    });
    expect(unknown.json().code).toBe('CHAT_NOT_FOUND');
  });

  it('stops malformed normalization before inference and suppresses an assistant response', async () => {
    t = await createTestApp();
    await audioDefinition(true);
    const upload = await uploadAudio(Buffer.from('x'), 'audio/mp4');
    expect(upload.statusCode, upload.body).toBe(201);
    const id = await conversation();
    t.harness.script([{ finalText: 'Must be suppressed' }]);
    const sent = await t.app.inject({
      method: 'POST',
      url: `/chat/conversations/${id}/turns`,
      payload: {
        requestId: randomUUID(),
        input: { kind: 'audio', audioId: upload.json().id },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    await t.idle();
    const turn = (await t.app.inject(`/chat/turns/${sent.json<ChatTurn>().id}`)).json<ChatTurn>();
    expect(turn.runStatus).toBe('failed');
    expect(turn.response).toBeUndefined();
    expect(turn.error?.code).toBe('CHAT_AUDIO_NORMALIZATION_INVALID');
    expect(t.harness.started).toHaveLength(0);
  });

  it('releases upload reservations on storage/stream errors and applies audience limits before reading a body', async () => {
    t = await createTestApp();
    await audioDefinition();
    const write = vi.spyOn(t.container.chatAudio, 'write');
    for (const error of [
      new ChatAudioStoreError('too_large'),
      new ChatAudioStoreError('storage', {
        cause: Object.assign(new Error('PRIVATE_ENOSPC_PATH'), { code: 'ENOSPC' }),
      }),
      new Error('PRIVATE_STREAM_PATH'),
    ]) {
      write.mockRejectedValueOnce(error);
      const upload = await uploadAudio(Buffer.from('x'), 'audio/flac');
      expect(upload.statusCode).toBe(
        error instanceof ChatAudioStoreError ? (error.code === 'too_large' ? 413 : 507) : 500,
      );
      expect(upload.body).not.toMatch(/PRIVATE_ENOSPC_PATH|PRIVATE_STREAM_PATH/);
    }
    for (let i = 0; i < 3; i++)
      expect((await uploadAudio(Buffer.from('x'), 'audio/flac')).statusCode).toBe(201);
    expect((await uploadAudio(Buffer.from('x'), 'audio/flac')).statusCode).toBe(429);
    const unknown = t.container.ports.ids.next();
    for (let i = 0; i < 30; i++) expect((await send(unknown)).statusCode).toBe(404);
    expect((await send(unknown)).statusCode).toBe(429);
  });
});

it('normalizes only documented media metadata and safe configured pairing origins', () => {
  for (const value of [
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/flac',
    'video/webm',
    'video/mp4',
  ])
    expect(normalizeChatMediaType(value)).toBe(value);
  expect(normalizeChatMediaType('audio/mp4;codecs="mp4a.40.2"')).toBe('audio/mp4');
  for (const value of [
    undefined,
    'audio/nope',
    'audio/webm;codecs=opus;other=true',
    'audio/ogg;codecs=""',
  ])
    expect(() => normalizeChatMediaType(value)).toThrow();
  for (const value of [
    undefined,
    'not a url',
    'http://remote.test',
    'https://user:secret@example.com',
    'https://example.com/?q=1',
    'https://example.com/#x',
  ])
    expect(pairingBaseUrl(value)).toBeUndefined();
  for (const value of [
    'https://example.com/base',
    'http://localhost:4747',
    'http://127.0.0.1:4747',
    'http://[::1]:4747',
  ])
    expect(pairingBaseUrl(value)?.pathname).toBe('/goblin/');
});
