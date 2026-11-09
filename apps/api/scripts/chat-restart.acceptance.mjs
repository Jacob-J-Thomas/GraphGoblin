// Run after the backend build: pnpm test:chat-restart. No provider/model turn is performed.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { log } from 'node:console';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { createSystemChatDefinition, enableChatAudio } from '@graphgoblin/domain';

const { fetch, AbortSignal } = globalThis;
const fixture = fileURLToPath(new URL('./chat-restart.fixture.mjs', import.meta.url));
const prefix = 'gg-chat-restart-';

// A short complete mono 16 kHz PCM16 WAV; binary identity matters, no real speech/model is used.
function canonicalWav() {
  const samples = 160;
  const bytes = Buffer.alloc(44 + samples * 2);
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
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    bytes.writeInt16LE(index % 2 ? 32_767 : -32_768, 44 + index * 2);
  return bytes;
}
const audioDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function eventually(check, label, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= until) throw new Error(`Disposable Chat deadline: ${label}`);
    await delay(25);
  }
}

async function freePort() {
  const start = Number(process.env.GG_TEST_PORT_START ?? 6390);
  const count = Number(process.env.GG_TEST_PORT_COUNT ?? 20);
  assert.ok(
    Number.isInteger(start) &&
      start > 0 &&
      Number.isInteger(count) &&
      count > 0 &&
      start + count <= 65536,
  );
  for (let port = start; port < start + count; port++) {
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No disposable Chat API port in the configured test range');
}

const normalizer = (marker, malformed = false) => ({
  id: 'chat-normalize',
  kind: 'script',
  label: 'Fixture byte normalizer',
  ui: { x: 160, y: 0 },
  config: {
    command: process.execPath,
    args: [
      '-e',
      `const fs=require('node:fs');let body='';process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>{const p=JSON.parse(body).invocation.trigger.payload;fs.appendFileSync(process.env.CHAT_RESTART_MARKER,JSON.stringify({phase:'normalize',requestId:p.requestId})+'\\n');const text=p.input.kind==='text'?p.input.text:'fixture bytes '+fs.readFileSync(p.input.audio.path).toString('hex');process.stdout.write(JSON.stringify(${malformed ? '{bad:true}' : '{text}'}));});`,
    ],
    env: { CHAT_RESTART_MARKER: marker },
    stdin: 'thread',
    stdout: 'last-output',
    cwd: 'workspace',
  },
});

function definition(marker, malformed = false) {
  const def = enableChatAudio(
    createSystemChatDefinition({ name: 'Process Chat acceptance', harness: 'codex' }),
    normalizer(marker, malformed),
  );
  const edge = def.edges.find(
    (item) => item.from.node === 'chat-normalize-check' && item.from.port === 'valid',
  );
  edge.to = { node: 'effect', port: 'in' };
  def.nodes.push({
    id: 'effect',
    kind: 'script',
    label: 'Disposable external effect',
    ui: { x: 400, y: 0 },
    config: {
      command: process.execPath,
      args: [
        '-e',
        "const fs=require('node:fs');let body='';process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>{const p=JSON.parse(body).invocation.trigger.payload;fs.appendFileSync(process.env.CHAT_RESTART_MARKER,JSON.stringify({phase:'effect',requestId:p.requestId})+'\\n');process.stdout.write('{}');});",
      ],
      env: { CHAT_RESTART_MARKER: marker, CHAT_RESTART_PHASE: 'effect' },
      stdin: 'thread',
      stdout: 'ignore',
      cwd: 'workspace',
    },
  });
  def.edges.push({
    id: 'effect-response',
    from: { node: 'effect', port: 'out' },
    to: { node: 'respond', port: 'in' },
  });
  return def;
}

test(
  'native Chat admission, uncertain effects and private audio survive a real process restart without replay',
  { timeout: 180_000 },
  async () => {
    const dataDir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    const marker = join(dataDir, 'effects.jsonl');
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const audioDirectory = join(dataDir, 'chat-audio');
    const children = [];
    let partial;
    let succeeded = false;
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.toUpperCase().startsWith('GG_') &&
          !key.startsWith('CHAT_RESTART_') &&
          key.toUpperCase() !== 'JEV_API_KEY' &&
          key !== 'NODE_V8_COVERAGE',
      ),
    );
    const env = {
      ...inherited,
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_REQUIRE_API_KEY: 'true',
      GG_PUBLIC_URL: origin,
      GG_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
      GG_SWAGGER_UI: 'false',
      GG_WEB_DIST: '',
      GG_GOBLIN_DIST: '',
      GG_OLLAMA_ENABLED: 'false',
      GG_JEV_API_KEY: '',
      GG_LOG_LEVEL: 'silent',
      GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } }),
    };
    function boot(first = false, clockOffsetMs = 0) {
      const child = spawn(process.execPath, [fixture], {
        env: {
          ...env,
          CHAT_RESTART_BOOTSTRAP: first ? '1' : '0',
          CHAT_RESTART_HOLD: first ? '1' : '0',
          CHAT_RESTART_CLOCK_OFFSET_MS: String(clockOffsetMs),
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const messages = [];
      let output = '';
      child.stdout.on('data', (chunk) => {
        output = (output + chunk).slice(-8192);
      });
      child.stderr.on('data', (chunk) => {
        output = (output + chunk).slice(-8192);
      });
      child.on('message', (message) => messages.push(message));
      const closed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      void closed.catch(() => undefined);
      const server = {
        child,
        closed,
        output: () => output,
        async message(type) {
          await eventually(() => {
            if (messages.some((message) => message.type === type)) return true;
            if (child.exitCode !== null || child.signalCode !== null)
              throw new Error(`Disposable child exited before ${type}: ${output}`);
            return false;
          }, type);
          return messages.splice(
            messages.findIndex((message) => message.type === type),
            1,
          )[0];
        },
        async kill() {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await eventually(
            () => child.exitCode !== null || child.signalCode !== null,
            'child exit',
          );
          return closed;
        },
      };
      children.push(server);
      return server;
    }
    async function call(token, method, path, body, expected = 200, extra = {}) {
      const response = await fetch(origin + path, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.status, expected, `${method} ${path}: unexpected status`);
      if (response.status === 204) return undefined;
      return response.json();
    }
    async function upload(token, bytes, uploadId, expected = 201) {
      const response = await fetch(origin + '/chat/audio', {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'audio/wav',
          'idempotency-key': uploadId,
          'x-content-sha256': audioDigest(bytes),
        },
        body: bytes,
      });
      const value = await response.json();
      assert.equal(
        response.status,
        expected,
        `raw upload unexpected status (${value.code ?? 'metadata'})`,
      );
      assert.equal('path' in value, false);
      assert.equal(JSON.stringify(value).includes(dataDir), false);
      return value;
    }
    const entries = async () =>
      (await readFile(marker, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const effects = async (requestId, phase = 'effect') =>
      (await entries()).filter((entry) => entry.requestId === requestId && entry.phase === phase)
        .length;
    try {
      let server = boot(true);
      const owner = (await server.message('ready')).ownerToken;
      assert.equal(typeof owner, 'string');
      await call(undefined, 'GET', '/chat/session', undefined, 401);
      const session = await call(owner, 'GET', '/chat/session');
      const gateway = session.systemLoopId;
      await call(owner, 'PUT', `/loops/${gateway}/draft`, { definition: definition(marker) });
      await call(owner, 'POST', `/loops/${gateway}/publish`, {});
      const pairing = await call(owner, 'POST', '/chat/pairings', {}, 201);
      const device = `ggd_${randomBytes(32).toString('base64url')}`;
      const claim = await call(undefined, 'POST', '/chat/pairings/claim', {
        code: pairing.code,
        claimId: randomUUID(),
        deviceToken: device,
        label: 'Process fixture',
      });
      const devices = await call(owner, 'GET', '/chat/devices');
      const deviceLoop = devices.items.find((item) => item.id === claim.deviceId).loopId;
      const conversation = await call(device, 'POST', '/chat/conversations', {}, 201);
      const ownerConversation = await call(owner, 'POST', '/chat/conversations', {}, 201);
      await call(
        device,
        'GET',
        `/chat/conversations/${ownerConversation.id}/turns`,
        undefined,
        404,
      );
      const bytes = canonicalWav();
      // Missing identity must fail before reservation; the old fixture omitted these headers.
      const missingIdentity = await fetch(origin + '/chat/audio', {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${device}`, 'content-type': 'audio/wav' },
        body: bytes,
      });
      assert.equal(missingIdentity.status, 400);
      assert.equal((await missingIdentity.json()).code, 'CHAT_AUDIO_UPLOAD_IDENTITY_REQUIRED');
      const uploadId = randomUUID();
      const audio = await upload(device, bytes, uploadId);
      assert.equal(audio.mimeType, 'audio/wav');
      assert.equal(audio.bytes, bytes.length);
      assert.deepEqual(await call(device, 'GET', `/chat/audio/requests/${uploadId}`), {
        state: 'ready',
        audio,
      });
      await call(undefined, 'GET', `/chat/audio/requests/${uploadId}`, undefined, 401);
      const foreignUpload = await call(
        owner,
        'GET',
        `/chat/audio/requests/${uploadId}`,
        undefined,
        404,
      );
      const unknownUpload = await call(
        owner,
        'GET',
        `/chat/audio/requests/${randomUUID()}`,
        undefined,
        404,
      );
      assert.equal(
        foreignUpload.code,
        unknownUpload.code,
        'foreign and unknown upload identities must be indistinguishable',
      );
      assert.deepEqual(
        await upload(device, bytes, uploadId),
        audio,
        'an acknowledged upload duplicate must reuse the exact metadata',
      );
      assert.equal(
        (await readdir(audioDirectory)).filter((name) => name.endsWith('.audio')).length,
        1,
      );
      const changedBytes = Buffer.from(bytes);
      changedBytes[changedBytes.length - 1] ^= 1;
      assert.equal(
        (await upload(device, changedBytes, uploadId, 409)).code,
        'CHAT_AUDIO_UPLOAD_CONFLICT',
      );
      const requestId = randomUUID();
      const sent = { requestId, input: { kind: 'audio', audioId: audio.id } };
      let acknowledgement = false;
      const lost = call(device, 'POST', `/chat/conversations/${conversation.id}/turns`, sent, 202, {
        'x-chat-restart-drop-ack': '1',
      }).then(
        () => {
          acknowledgement = true;
          return 'acknowledged';
        },
        () => 'lost',
      );
      const admitted = (await server.message('admitted-without-ack')).turn;
      await server.message('effect-held');
      assert.equal(
        acknowledgement,
        false,
        'the client must not have received an admission acknowledgement',
      );
      assert.equal(await effects(requestId), 1);
      assert.equal(await effects(requestId, 'normalize'), 1);
      await call(device, 'GET', `/runs/${admitted.runId}`, undefined, 403);
      const thread = await call(owner, 'GET', `/runs/${admitted.runId}/thread`);
      const privatePath = thread.invocation.trigger.payload.input.audio.path;
      assert.equal(dirname(privatePath), audioDirectory);
      assert.deepEqual(await readFile(privatePath), bytes);
      assert.equal(JSON.stringify(admitted).includes(privatePath), false);
      if (process.platform !== 'win32') assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
      // Crash a real streaming upload too. It has a reservation and partial private bytes, no metadata commit.
      const partialUploadId = randomUUID();
      partial = httpRequest(origin + '/chat/audio', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${device}`,
          'content-type': 'audio/wav',
          'content-length': bytes.length,
          'idempotency-key': partialUploadId,
          'x-content-sha256': audioDigest(bytes),
        },
      });
      partial.on('error', () => undefined);
      partial.write(bytes.subarray(0, 46));
      let abandoned;
      await eventually(async () => {
        abandoned = (await readdir(audioDirectory)).filter(
          (name) => name.endsWith('.tmp') || name.endsWith('.lock'),
        );
        return abandoned.some((name) => name.endsWith('.tmp'));
      }, 'partial upload on disk');
      assert.deepEqual(await call(device, 'GET', `/chat/audio/requests/${partialUploadId}`), {
        state: 'receiving',
      });
      await call(owner, 'GET', `/chat/audio/requests/${partialUploadId}`, undefined, 404);
      assert.equal(
        (await upload(device, bytes, partialUploadId, 409)).code,
        'CHAT_AUDIO_UPLOAD_IN_PROGRESS',
      );
      for (const name of abandoned)
        assert.ok(
          (await stat(join(audioDirectory, name))).mtimeMs > Date.now() - 60_000,
          'the interrupted upload must be recent enough to require startup cleanup',
        );
      const before = (await call(owner, 'GET', `/runs/${admitted.runId}/events`)).items;
      assert.equal(before.filter((event) => event.type === 'run.queued').length, 1);
      assert.equal(
        before.filter((event) => event.type === 'script.dispatched' && event.nodeId === 'effect')
          .length,
        1,
      );
      assert.equal((await server.kill()).signal, 'SIGKILL');
      partial.destroy();
      assert.equal(await lost, 'lost');
      server = boot();
      await server.message('ready');
      assert.deepEqual(
        await call(device, 'GET', `/chat/audio/requests/${uploadId}`),
        { state: 'ready', audio },
        'a restart must preserve the completed upload acknowledgement',
      );
      assert.deepEqual(await call(device, 'GET', `/chat/audio/requests/${partialUploadId}`), {
        state: 'failed',
        code: 'CHAT_AUDIO_UPLOAD_INTERRUPTED',
      });
      await call(owner, 'GET', `/chat/audio/requests/${partialUploadId}`, undefined, 404);
      assert.equal(
        (await upload(device, bytes, partialUploadId, 410)).code,
        'CHAT_AUDIO_UPLOAD_RETIRED',
        'an interrupted upload identity must never restart',
      );
      let recovered;
      await eventually(async () => {
        recovered = await call(
          device,
          'GET',
          `/chat/conversations/${conversation.id}/requests/${requestId}`,
        );
        return recovered.runStatus === 'failed';
      }, 'native uncertain Script recovery');
      assert.equal(recovered.id, admitted.id);
      assert.equal(recovered.runId, admitted.runId);
      assert.equal(recovered.error.code, 'SCRIPT_OUTCOME_UNCERTAIN');
      assert.equal(recovered.response, undefined);
      assert.equal(recovered.inputTranscript, `fixture bytes ${bytes.toString('hex')}`);
      assert.deepEqual(
        await readFile(privatePath),
        bytes,
        'consumed audio must survive native recovery',
      );
      const afterCleanup = await readdir(audioDirectory);
      for (const name of abandoned)
        assert.equal(
          afterCleanup.includes(name),
          false,
          'startup must remove an interrupted upload',
        );
      const duplicate = await call(
        device,
        'POST',
        `/chat/conversations/${conversation.id}/turns`,
        sent,
        202,
      );
      assert.equal(duplicate.runId, admitted.runId);
      assert.equal(duplicate.id, admitted.id);
      assert.equal(duplicate.runStatus, 'failed');
      const changed = await call(
        device,
        'POST',
        `/chat/conversations/${conversation.id}/turns`,
        { requestId, input: { kind: 'text', text: 'different command' } },
        409,
      );
      assert.equal(changed.code, 'CHAT_REQUEST_CONFLICT');
      await delay(100);
      assert.equal(
        await effects(requestId),
        1,
        'lookup and explicit duplicate must not execute a command again',
      );
      assert.equal((await call(owner, 'GET', `/runs?loopId=${deviceLoop}`)).items.length, 1);
      const durable = (await call(owner, 'GET', `/runs/${admitted.runId}/events`)).items;
      assert.equal(durable.filter((event) => event.type === 'run.queued').length, 1);
      assert.equal(
        durable.filter((event) => event.type === 'script.dispatched' && event.nodeId === 'effect')
          .length,
        1,
      );
      // A malformed real normalizer must fail before the external effect or harness is reached.
      await call(owner, 'PUT', `/loops/${gateway}/draft`, { definition: definition(marker, true) });
      await call(owner, 'POST', `/loops/${gateway}/publish`, {});
      const badAudio = await upload(owner, bytes, randomUUID());
      const badRequest = randomUUID();
      const bad = await call(
        owner,
        'POST',
        `/chat/conversations/${ownerConversation.id}/turns`,
        { requestId: badRequest, input: { kind: 'audio', audioId: badAudio.id } },
        202,
      );
      let rejected;
      await eventually(async () => {
        rejected = await call(owner, 'GET', `/chat/turns/${bad.id}`);
        return rejected.runStatus === 'failed';
      }, 'normalization rejection');
      assert.equal(rejected.error.code, 'CHAT_AUDIO_NORMALIZATION_INVALID');
      assert.equal(rejected.response, undefined);
      assert.equal(await effects(badRequest), 0);
      const badEvents = (await call(owner, 'GET', `/runs/${bad.runId}/events`)).items;
      assert.equal(
        badEvents.some(
          (event) =>
            event.type === 'harness.turn' ||
            (event.type === 'script.dispatched' && event.nodeId === 'effect'),
        ),
        false,
      );
      // A distinct, explicit new request still executes normally on the device's published clone.
      const nextRequest = randomUUID();
      const nextInput = {
        requestId: nextRequest,
        input: { kind: 'text', text: 'Explicit new command' },
      };
      const next = await call(
        device,
        'POST',
        `/chat/conversations/${conversation.id}/turns`,
        nextInput,
        202,
      );
      let completed;
      await eventually(async () => {
        completed = await call(device, 'GET', `/chat/turns/${next.id}`);
        return completed.runStatus === 'succeeded';
      }, 'explicit new turn');
      assert.deepEqual(completed.response, {
        protocol: 'graphgoblin.chat.v1',
        reply: 'Exact native fixture reply',
      });
      assert.equal(await effects(nextRequest), 1);
      const unusedUploadId = randomUUID();
      const unusedAudio = await upload(owner, bytes, unusedUploadId);
      const unusedPath = join(audioDirectory, `${unusedAudio.id}.audio`);
      assert.deepEqual(await readFile(unusedPath), bytes);
      server.child.send({ type: 'stop' });
      await eventually(() => server.child.exitCode !== null, 'graceful child stop');
      assert.equal((await server.closed).code, 0);
      // A separate restart advances only the fixture clock beyond unused-upload expiration.
      // The earlier restart used the real clock, proving recent partial bytes were cleaned.
      const expiredClockOffset = 2 * 60 * 60_000;
      assert.ok(Date.now() + expiredClockOffset > Date.parse(audio.expiresAt));
      server = boot(false, expiredClockOffset);
      await server.message('ready');
      const completedLookup = await call(
        device,
        'GET',
        `/chat/conversations/${conversation.id}/requests/${nextRequest}`,
      );
      assert.equal(completedLookup.runId, next.runId);
      assert.deepEqual(completedLookup.response, completed.response);
      assert.equal(
        (await call(device, 'POST', `/chat/conversations/${conversation.id}/turns`, nextInput, 202))
          .runId,
        next.runId,
      );
      assert.equal(await effects(nextRequest), 1);
      assert.equal(await effects(requestId), 1);
      assert.equal((await call(owner, 'GET', `/runs?loopId=${deviceLoop}`)).items.length, 2);
      assert.deepEqual(await readFile(privatePath), bytes);
      assert.equal(
        (await call(owner, 'GET', `/chat/audio/requests/${unusedUploadId}`, undefined, 410)).code,
        'CHAT_AUDIO_UPLOAD_RETIRED',
      );
      await assert.rejects(
        stat(unusedPath),
        { code: 'ENOENT' },
        'expired unused audio must be removed',
      );
      assert.equal(
        (await upload(owner, bytes, unusedUploadId, 410)).code,
        'CHAT_AUDIO_UPLOAD_RETIRED',
        'a retired upload identity must never recreate expired audio',
      );
      await assert.rejects(stat(unusedPath), { code: 'ENOENT' });
      assert.deepEqual(
        await call(device, 'GET', `/chat/audio/requests/${partialUploadId}`),
        { state: 'failed', code: 'CHAT_AUDIO_UPLOAD_INTERRUPTED' },
        'interrupted upload disposition must also survive a second restart',
      );
      log(
        JSON.stringify({
          acceptance: 'chat-restart',
          admittedOnce: true,
          lostAcknowledgement: true,
          recovered: 'same run; Script uncertainty held without replay',
          authenticated: 'owner and paired device',
          audio:
            'canonical WAV private bytes retained beyond unused expiry; interrupted and expired unused files removed',
          uploadIdentity:
            'ready acknowledgement survived restart; scoped recovery, conflict and terminal no-recreation verified',
          malformedNormalizer: 'rejected before external effect',
          explicitNewTurn: 'exact native fixture reply',
        }),
      );
      succeeded = true;
    } finally {
      partial?.destroy();
      for (const child of children) await child.kill();
      assert.equal(dirname(resolve(dataDir)), await realpath(tmpdir()));
      assert.ok(basename(dataDir).startsWith(prefix));
      if (succeeded)
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      else log(JSON.stringify({ disposableFailureStore: dataDir }));
    }
  },
);
