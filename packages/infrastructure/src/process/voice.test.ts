import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { StatsFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptPort, ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';
import {
  inspectVoiceModel,
  inspectVoiceRuntime,
  LocalVoiceInstaller,
  localVoiceFingerprint,
  readVoiceWav,
  transcribeLocal,
  transcribeOpenAI,
  VOICE_MODEL_BYTES,
  VoiceProviderError,
  VoiceNativeScriptError,
  type VoiceRuntimeQualificationRecord,
} from './voice.js';
import { VOICE_MODELS, type VoiceModelId } from './voice-models.js';
import type * as ModelManifest from './voice-models.js';

const weights = vi.hoisted(() => ({
  tiny: Buffer.from('tiny model test weights'),
  base: Buffer.from('base model test weights'),
}));
vi.mock('./voice-models.js', async () => {
  const { createHash } = await import('node:crypto');
  const model = (name: string, bytes: Buffer) => ({
    filename: `ggml-${name}.bin`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    license: 'MIT',
  });
  return {
    VOICE_MODELS: {
      'tiny.en': model('tiny.en', weights.tiny),
      'base.en': model('base.en', weights.base),
    },
  };
});
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises');
  return { ...actual, statfs: vi.fn(actual.statfs) };
});

function wav(dataBytes = 32_000): Buffer {
  const bytes = Buffer.alloc(44 + dataBytes);
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
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}
const finished: ScriptRunResult = {
  state: 'completed',
  exitCode: 0,
  stdout: ' recognized speech\n',
  stderr: '',
  stdoutBytes: 19,
  stderrBytes: 0,
  timedOut: false,
  stdoutOverflow: false,
  stderrOverflow: false,
};
const signal = () => new AbortController().signal;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let directory: string;
let executable: string;
let modelPath: string;
let audioPath: string;
const scripts = () => ({ run: vi.fn<ScriptPort['run']>().mockResolvedValue({ ...finished }) });
const qualified = {
  inspectRuntime: vi
    .fn<(_executable: string) => Promise<{ qualified: boolean; message: string }>>()
    .mockResolvedValue({ qualified: true, message: 'Reviewed runtime' }),
};

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'gg-voice-test-')));
  vi.mocked(fs.statfs).mockImplementation(
    (await vi.importActual<typeof fs>('node:fs/promises')).statfs,
  );
  executable = join(directory, 'whisper-cli');
  modelPath = join(directory, 'existing-model.bin');
  audioPath = join(directory, 'audio.wav');
  await fs.writeFile(executable, 'reviewed binary', { mode: 0o700 });
  await fs.writeFile(modelPath, 'existing model', { mode: 0o600 });
  await fs.writeFile(audioPath, wav(), { mode: 0o600 });
  qualified.inspectRuntime.mockResolvedValue({ qualified: true, message: 'Reviewed runtime' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function qualification(): Promise<VoiceRuntimeQualificationRecord> {
  const dependency = join(directory, 'dependency.dylib');
  await fs.writeFile(dependency, 'reviewed dependency');
  const loader = join(directory, 'backends');
  await fs.mkdir(loader);
  const backend = join(loader, 'libggml-cpu.so');
  await fs.writeFile(backend, 'reviewed backend');
  const backendAlias = join(loader, 'libggml-alias.so');
  await fs.symlink(backend, backendAlias);
  const record: VoiceRuntimeQualificationRecord = {
    formatVersion: 1,
    executable: {
      path: executable,
      realpath: executable,
      sha256: sha(await fs.readFile(executable)),
      license: 'MIT',
      version: '1.9.2',
    },
    dependencies: [
      {
        path: dependency,
        realpath: dependency,
        sha256: sha(await fs.readFile(dependency)),
        license: 'Apache-2.0 WITH LLVM-exception',
      },
    ],
    dependencyDirectories: [
      {
        path: loader,
        realpath: loader,
        entries: [
          {
            name: 'libggml-cpu.so',
            type: 'file',
            realpath: backend,
            sha256: sha(await fs.readFile(backend)),
          },
          {
            name: 'libggml-alias.so',
            type: 'symlink',
            realpath: backend,
            sha256: sha(await fs.readFile(backend)),
          },
        ],
      },
    ],
    evidence: { id: 'operator-build-license-review', sha256: 'a'.repeat(64) },
    qualifiedAt: '2026-11-08T12:00:00.000Z',
  };
  await saveQualification(record);
  return record;
}
async function saveQualification(record: unknown): Promise<void> {
  await fs.mkdir(join(directory, 'voice'), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    join(directory, 'voice', 'runtime-qualification.json'),
    JSON.stringify(record),
    { mode: 0o600 },
  );
}
const local = () => ({ executable, modelPath });
function installer(
  fetcher: typeof fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(weights.tiny)),
  options = qualified,
): LocalVoiceInstaller {
  return new LocalVoiceInstaller(directory, scripts(), fetcher, options);
}

describe('voice manifests and filesystem boundaries', () => {
  it('pins both real immutable upstream assets and MIT model licensing', async () => {
    const actual = await vi.importActual<typeof ModelManifest>('./voice-models.js');
    expect(Object.isFrozen(actual.VOICE_MODELS)).toBe(true);
    expect(actual.VOICE_MODELS['tiny.en']).toMatchObject({
      revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
      bytes: 77_704_715,
      sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
      license: 'MIT',
    });
    expect(actual.VOICE_MODELS['base.en']).toMatchObject({
      bytes: 147_964_211,
      sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
      license: 'MIT',
    });
    expect(VOICE_MODEL_BYTES).toBe(weights.tiny.length);
  });
  it('fingerprints actual files, notices replacement, and never treats identity as licence proof', async () => {
    const before = await localVoiceFingerprint(local());
    expect(before).toMatch(/^[a-f0-9]{64}$/);
    await fs.writeFile(modelPath, 'different model');
    expect(await localVoiceFingerprint(local())).not.toBe(before);
    expect(await readVoiceWav(audioPath)).toEqual(wav());
  });
  it.each(['relative', 'null', 'missing', 'directory', 'empty'])(
    'rejects invalid local %s',
    async (kind) => {
      const config = local();
      if (kind === 'relative') config.executable = 'relative';
      if (kind === 'null') config.executable += '\0';
      if (kind === 'missing') config.executable += '-missing';
      if (kind === 'directory') config.modelPath = directory;
      if (kind === 'empty') await fs.writeFile(modelPath, '');
      await expect(localVoiceFingerprint(config)).rejects.toBeInstanceOf(VoiceProviderError);
    },
  );
  it.each(['missing', 'symlink', 'directory', 'short', 'oversized', 'invalid'])(
    'rejects unavailable or unsafe audio: %s',
    async (kind) => {
      let path = audioPath;
      if (kind === 'missing') path += '-missing';
      if (kind === 'symlink') {
        path += '-link';
        await fs.symlink(audioPath, path);
      }
      if (kind === 'directory') path = directory;
      if (kind === 'short') await fs.writeFile(path, Buffer.alloc(4));
      if (kind === 'oversized') await fs.truncate(path, 10 * 1024 * 1024 + 1);
      if (kind === 'invalid') await fs.writeFile(path, Buffer.alloc(46));
      await expect(readVoiceWav(path)).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' });
    },
  );
  it.each([0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40])(
    'refuses malformed canonical WAV header at byte %s before cloud dispatch',
    async (offset) => {
      const audio = wav();
      audio[offset] = (audio[offset] ?? 0) ^ 0xff;
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        transcribeOpenAI(audio, 'explicit-voice-key', signal(), fetcher),
      ).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([1, 120 * 32_000 + 2, 10 * 1024 * 1024])(
    'rejects misaligned or oversized PCM length %s',
    async (bytes) => {
      await expect(transcribeOpenAI(wav(bytes), 'key', signal(), vi.fn())).rejects.toMatchObject({
        code: 'VOICE_AUDIO_INVALID',
      });
    },
  );
});

describe('private runtime qualification', () => {
  it('requires a matching operator record and all current dependency hashes', async () => {
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
    const record = await qualification();
    const first = await inspectVoiceRuntime(directory, executable);
    expect(first).toMatchObject({
      qualified: true,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await fs.writeFile(record.dependencies[0]!.path, 'changed dependency');
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it('invalidates changed runtime binary and symlink target identities', async () => {
    const record = await qualification();
    await fs.writeFile(executable, 'replacement binary');
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
    await fs.writeFile(executable, 'reviewed binary');
    const target = join(directory, 'new-dependency');
    await fs.writeFile(target, 'reviewed dependency');
    await fs.rm(record.dependencies[0]!.path);
    await fs.symlink(target, record.dependencies[0]!.path);
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it.each([
    'record-public',
    'parent-public',
    'record-link',
    'parent-link',
    'bad-json',
    'too-large',
    'empty',
    'directory',
  ])('refuses unsafe qualification storage: %s', async (kind) => {
    await qualification();
    const parent = join(directory, 'voice');
    const path = join(parent, 'runtime-qualification.json');
    if (kind === 'record-public') await fs.chmod(path, 0o644);
    if (kind === 'parent-public') await fs.chmod(parent, 0o755);
    if (kind === 'record-link') {
      const next = join(directory, 'record');
      await fs.rename(path, next);
      await fs.symlink(next, path);
    }
    if (kind === 'parent-link') {
      const next = join(directory, 'state');
      await fs.rename(parent, next);
      await fs.symlink(next, parent);
    }
    if (kind === 'bad-json') await fs.writeFile(path, '{');
    if (kind === 'too-large') await fs.writeFile(path, 'x'.repeat(65_537));
    if (kind === 'empty') await fs.writeFile(path, '');
    if (kind === 'directory') {
      await fs.rm(path);
      await fs.mkdir(path);
    }
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it.each([
    null,
    { formatVersion: 2 },
    { executable: null },
    { executable: { path: 'relative' } },
    { executable: { realpath: 'relative' } },
    { executable: { sha256: 'bad' } },
    { executable: { license: 'GPL-3.0' } },
    { executable: { version: '' } },
    { dependencies: null },
    { dependencies: [{}] },
    { dependencies: Array.from({ length: 257 }, () => ({})) },
    { evidence: null },
    { evidence: {} },
    { evidence: { id: '', sha256: 'a'.repeat(64) } },
    { evidence: { id: 'review', sha256: 'bad' } },
    { qualifiedAt: null },
    { qualifiedAt: 'invalid' },
  ])('refuses malformed or unreviewed runtime evidence %#', async (patch) => {
    const record = await qualification();
    const next =
      patch === null
        ? null
        : {
            ...record,
            ...patch,
            ...(patch.executable
              ? { executable: { ...record.executable, ...patch.executable } }
              : {}),
          };
    await saveQualification(next);
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it('rejects selection of a different binary, nonexecutables and invalid paths', async () => {
    await qualification();
    expect((await inspectVoiceRuntime(directory, modelPath)).qualified).toBe(false);
    expect((await inspectVoiceRuntime(directory, 'relative')).qualified).toBe(false);
    await fs.chmod(executable, 0o600);
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it.each(['added', 'removed', 'type', 'duplicate', 'target', 'hash', 'directory-path'])(
    'rejects a changed backend loader inventory: %s',
    async (kind) => {
      const record = await qualification();
      const loader = record.dependencyDirectories[0]!;
      if (kind === 'added')
        await fs.writeFile(join(loader.path, 'libggml-unreviewed.so'), 'unreviewed');
      if (kind === 'removed') await fs.rm(join(loader.path, 'libggml-alias.so'));
      if (kind === 'type') {
        await fs.rm(join(loader.path, 'libggml-alias.so'));
        await fs.mkdir(join(loader.path, 'libggml-alias.so'));
      }
      if (kind === 'duplicate') {
        loader.entries[1] = loader.entries[0]!;
        await saveQualification(record);
      }
      if (kind === 'target') {
        const extra = join(directory, 'replacement');
        await fs.writeFile(extra, 'reviewed backend');
        await fs.rm(join(loader.path, 'libggml-alias.so'));
        await fs.symlink(extra, join(loader.path, 'libggml-alias.so'));
      }
      if (kind === 'hash')
        await fs.writeFile(join(loader.path, 'libggml-cpu.so'), 'changed backend');
      if (kind === 'directory-path') {
        loader.realpath = directory;
        await saveQualification(record);
      }
      expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
    },
  );
  it.each([
    null,
    [{}],
    Array.from({ length: 17 }, () => ({})),
    [{ path: 'relative' }],
    [{ path: '/absolute', realpath: 'relative' }],
    [{ path: '/absolute', realpath: '/absolute', entries: [{}] }],
  ])('refuses malformed loader directory inventories %#', async (dependencyDirectories) => {
    const record = await qualification();
    await saveQualification({ ...record, dependencyDirectories });
    expect((await inspectVoiceRuntime(directory, executable)).qualified).toBe(false);
  });
  it('qualifies only exact approved model bytes and rejects changed assets', async () => {
    expect((await inspectVoiceModel(modelPath)).qualified).toBe(false);
    await fs.writeFile(modelPath, weights.tiny);
    expect(await inspectVoiceModel(modelPath)).toMatchObject({
      qualified: true,
      fingerprint: sha(weights.tiny),
    });
    await fs.writeFile(modelPath, Buffer.alloc(weights.tiny.length));
    expect((await inspectVoiceModel(modelPath)).qualified).toBe(false);
    expect((await inspectVoiceModel('relative')).qualified).toBe(false);
  });
});

describe('direct bounded local transcription', () => {
  it('invokes the selected executable directly with canonical WAV, no inherited secrets and bounded output/deadline', async () => {
    const port = scripts();
    const cancellation = signal();
    const protectedRequest: ScriptRunRequest = {
      command: 'graphgoblin-voice-normalize',
      args: ['never-forward-this'],
      cwd: directory,
      signal: cancellation,
      env: { GG_VOICE_CONFIG: 'private configuration', SECRET: 'never-forward-this' },
      inheritEnv: true,
      stdin: 'protected thread with history, caption and private paths',
      timeoutMs: 125_000,
      maxStdoutBytes: 10,
      maxStderrBytes: 20,
    };
    expect(await transcribeLocal(port, local(), audioPath, protectedRequest)).toBe(
      'recognized speech',
    );
    expect(port.run).toHaveBeenCalledExactlyOnceWith({
      command: executable,
      args: ['-m', modelPath, '-f', audioPath, '-nt', '-np', '-l', 'en', '-t', '4'],
      env: {},
      inheritEnv: false,
      cwd: directory,
      signal: cancellation,
      timeoutMs: 120_000,
      maxStdoutBytes: 128_000,
      maxStderrBytes: 4096,
    });
    expect(port.run.mock.calls[0]?.[0]).not.toHaveProperty('stdin');
  });
  it.each<Partial<ScriptRunResult>>([
    { state: 'definitely-not-started', exitCode: null },
    { state: 'outcome-uncertain' },
    { terminationUnconfirmed: true },
    { state: 'outcome-uncertain', terminationUnconfirmed: true, exitCode: null },
    { exitCode: 1 },
    { timedOut: true },
    { stdoutOverflow: true },
    { stderrOverflow: true },
  ])('refuses unsuccessful or truncated process outcomes %#', async (change) => {
    const port = scripts();
    port.run.mockResolvedValue({
      ...finished,
      ...change,
      stderr: 'private diagnostic must not escape',
    });
    await expect(
      transcribeLocal(port, local(), audioPath, { cwd: directory, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'VOICE_LOCAL_FAILED',
      message: expect.not.stringContaining('private diagnostic'),
      nativeResult: {
        state: change.state ?? 'completed',
        ...(change.terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
        exitCode: change.exitCode === undefined || change.exitCode === 0 ? 1 : change.exitCode,
        stdout: '',
        stderr: 'VOICE_LOCAL_FAILED',
        stdoutBytes: 0,
        stderrBytes: Buffer.byteLength('VOICE_LOCAL_FAILED'),
        timedOut: change.timedOut ?? false,
        stdoutOverflow: change.stdoutOverflow ?? false,
        stderrOverflow: change.stderrOverflow ?? false,
      },
    });
    expect(port.run).toHaveBeenCalledTimes(1);
  });
  it.each([
    [' ', 'VOICE_NO_SPEECH'],
    ['a'.repeat(16_001), 'VOICE_TRANSCRIPT_TOO_LONG'],
  ])('does not accept or truncate invalid transcript %#', async (stdout, code) => {
    const port = scripts();
    port.run.mockResolvedValue({ ...finished, stdout });
    await expect(
      transcribeLocal(port, local(), audioPath, { cwd: directory, signal: signal() }),
    ).rejects.toMatchObject({ code });
  });
  it('does not dispatch cancelled or invalid audio and sanitizes process exceptions', async () => {
    const port = scripts();
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeLocal(port, local(), audioPath, { cwd: directory, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'VOICE_CANCELLED' });
    expect(port.run).not.toHaveBeenCalled();
    port.run.mockRejectedValue(new Error('private credential'));
    await expect(
      transcribeLocal(port, local(), audioPath, { cwd: directory, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'VOICE_LOCAL_FAILED',
      message: expect.not.stringContaining('private credential'),
      nativeResult: {
        state: 'outcome-uncertain',
        exitCode: null,
        stdout: '',
        stderr: 'VOICE_LOCAL_FAILED',
      },
    });
    const next = new AbortController();
    port.run.mockImplementation(() => {
      next.abort();
      return Promise.resolve(finished);
    });
    await expect(
      transcribeLocal(port, local(), audioPath, { cwd: directory, signal: next.signal }),
    ).rejects.toMatchObject({ code: 'VOICE_CANCELLED' });
  });
  it.each<Partial<ScriptRunResult>>([
    { state: 'outcome-uncertain' },
    { terminationUnconfirmed: true },
  ])('preserves unsafe native outcomes even when cancellation also arrives %#', async (change) => {
    const port = scripts();
    const controller = new AbortController();
    port.run.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        ...finished,
        ...change,
        stdout: 'private partial transcript',
        stderr: 'private process diagnostic',
      });
    });
    const error = await transcribeLocal(port, local(), audioPath, {
      cwd: directory,
      signal: controller.signal,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(VoiceNativeScriptError);
    expect(error).toMatchObject({
      code: 'VOICE_LOCAL_FAILED',
      nativeResult: {
        state: change.state ?? 'completed',
        ...(change.terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
        stdout: '',
        stderr: 'VOICE_LOCAL_FAILED',
      },
    });
    expect(JSON.stringify(error)).not.toContain('private');
  });
});

describe('fixed OpenAI file transcription', () => {
  it('uses only the explicit voice key and fixed native multipart endpoint/model, preserving returned speech', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: ' returned transcript ' }));
    expect(await transcribeOpenAI(wav(), 'explicit-voice-key', signal(), fetcher)).toBe(
      ' returned transcript ',
    );
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer explicit-voice-key' },
      signal: expect.any(AbortSignal),
    });
    const form = request!.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.get('response_format')).toBe('json');
    expect(Buffer.from(await (form.get('file') as Blob).arrayBuffer())).toEqual(wav());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, 'VOICE_CLOUD_CREDENTIAL_INVALID'],
    [429, 'VOICE_CLOUD_RATE_LIMITED'],
    [302, 'VOICE_CLOUD_FAILED'],
    [500, 'VOICE_CLOUD_FAILED'],
  ])('sanitizes HTTP %s with no retry', async (status, code) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('provider body with key', { status: Number(status) }));
    await expect(transcribeOpenAI(wav(), 'explicit-key', signal(), fetcher)).rejects.toMatchObject({
      code,
      message: expect.not.stringContaining('provider body'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'bad\nkey', 'x'.repeat(4097)])(
    'rejects unusable keys without a request %#',
    async (key) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(transcribeOpenAI(wav(), key, signal(), fetcher)).rejects.toMatchObject({
        code: 'VOICE_CLOUD_CREDENTIAL_INVALID',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([null, [], { text: 1 }, {}, 42, 'bad', { text: ' ' }, { text: 'a'.repeat(16_001) }])(
    'refuses invalid/empty/long transcript %#',
    async (value) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
      await expect(transcribeOpenAI(wav(), 'key', signal(), fetcher)).rejects.toBeInstanceOf(
        VoiceProviderError,
      );
    },
  );
  it.each([
    new Response('{'),
    new Response(null),
    new Response('x'.repeat(128_001)),
    new Response('{}', { headers: { 'content-length': '128001' } }),
    new Response('{}', { headers: { 'content-length': 'bad' } }),
  ])('bounds all provider response forms %#', async (response) => {
    await expect(
      transcribeOpenAI(wav(), 'key', signal(), vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: 'VOICE_CLOUD_INVALID_RESPONSE' });
  });
  it('never sends preaborted audio and treats lost acknowledgement/read cancellation as uncertain, without a retry', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(transcribeOpenAI(wav(), 'key', controller.signal, fetcher)).rejects.toMatchObject({
      code: 'VOICE_CANCELLED',
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error('key in network diagnostic'));
    await expect(transcribeOpenAI(wav(), 'key', signal(), fetcher)).rejects.toMatchObject({
      code: 'VOICE_CLOUD_OUTCOME_UNCERTAIN',
      message: expect.not.stringContaining('network diagnostic'),
    });
    const next = new AbortController();
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({ start: () => undefined, cancel })));
    const result = transcribeOpenAI(wav(), 'key', next.signal, fetcher);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    next.abort();
    await expect(result).rejects.toMatchObject({ code: 'VOICE_CLOUD_OUTCOME_UNCERTAIN' });
    expect(cancel).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds a fetch adapter that ignores its cancellation signal', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const operation = transcribeOpenAI(wav(), 'key', controller.signal, fetcher);
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'VOICE_CLOUD_OUTCOME_UNCERTAIN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('sanitizes failed stream reads and failed cancellation without exposing provider data', async () => {
    const cancel = vi.fn(() => {
      throw new Error('private cancel diagnostic');
    });
    const refused = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 });
    await expect(
      transcribeOpenAI(wav(), 'key', signal(), vi.fn<typeof fetch>().mockResolvedValue(refused)),
    ).rejects.toMatchObject({ code: 'VOICE_CLOUD_CREDENTIAL_INVALID' });
    const stream = new ReadableStream<Uint8Array>({
      pull: () => {
        throw new Error('private read diagnostic');
      },
    });
    await expect(
      transcribeOpenAI(
        wav(),
        'key',
        signal(),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
      ),
    ).rejects.toMatchObject({
      code: 'VOICE_CLOUD_OUTCOME_UNCERTAIN',
      message: expect.not.stringContaining('private'),
    });
    expect(cancel).toHaveBeenCalled();
  });
});

describe('bounded allowlisted model installation', () => {
  it('never starts build tools or downloads for missing/unqualified runtimes', async () => {
    const port = scripts();
    const fetcher = vi.fn<typeof fetch>();
    const operation = new LocalVoiceInstaller(directory, port, fetcher);
    await operation.start();
    expect(operation.progress).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('unsupported'),
    });
    await operation.start(local());
    expect(operation.progress.state).toBe('failed');
    expect(port.run).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await operation.inspect('relative')).qualified).toBe(false);
    expect((await operation.inspect(directory)).qualified).toBe(false);
    expect((await operation.inspect(`${executable}-missing`)).qualified).toBe(false);
  });
  it.each<VoiceModelId>(['tiny.en', 'base.en'])(
    'streams %s into an exclusively created private file and atomically commits verified bytes',
    async (id) => {
      const bytes = id === 'tiny.en' ? weights.tiny : weights.base;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
        );
      const operation = installer(fetcher);
      await operation.start(local(), id);
      expect(operation.progress).toMatchObject({
        state: 'ready',
        downloadedBytes: bytes.length,
        totalBytes: bytes.length,
      });
      expect(await fs.readFile(operation.modelPath)).toEqual(bytes);
      expect(operation.executable).toBe(executable);
      expect((await fs.stat(operation.modelPath)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(join(directory, 'voice', 'models'))).mode & 0o777).toBe(0o700);
      expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([
        VOICE_MODELS[id].filename,
      ]);
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/${VOICE_MODELS[id].revision}/${VOICE_MODELS[id].filename}`,
        { redirect: 'manual', signal: expect.any(AbortSignal) },
      );
      expect(qualified.inspectRuntime).toHaveBeenCalledTimes(2);
    },
  );
  it('uses an already valid model without network traffic', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const operation = installer(fetcher);
    await fs.mkdir(join(directory, 'voice', 'models'), { recursive: true });
    await fs.writeFile(operation.modelPath, weights.tiny);
    await operation.start(local());
    expect(operation.progress.state).toBe('ready');
    expect(fetcher).not.toHaveBeenCalled();
    expect(operation.progress.downloadedBytes).toBe(0);
  });
  it.each([
    'bad-hash',
    'short',
    'overflow',
    'length',
    'bad-length',
    'status',
    'no-body',
    'network',
  ])('retains the previous model and cleans every failed partial file: %s', async (kind) => {
    const fetcher = vi.fn<typeof fetch>();
    const operation = installer(fetcher);
    await fs.mkdir(join(directory, 'voice', 'models'), { recursive: true });
    await fs.writeFile(operation.modelPath, 'old model');
    if (kind === 'bad-hash')
      fetcher.mockResolvedValue(new Response(Buffer.alloc(weights.tiny.length)));
    if (kind === 'short') fetcher.mockResolvedValue(new Response('x'));
    if (kind === 'overflow')
      fetcher.mockResolvedValue(new Response(Buffer.alloc(weights.tiny.length + 1)));
    if (kind === 'length')
      fetcher.mockResolvedValue(
        new Response(weights.tiny, { headers: { 'content-length': '99999999999' } }),
      );
    if (kind === 'bad-length')
      fetcher.mockResolvedValue(
        new Response(weights.tiny, { headers: { 'content-length': 'bad' } }),
      );
    if (kind === 'status')
      fetcher.mockResolvedValue(new Response('private error', { status: 500 }));
    if (kind === 'no-body') fetcher.mockResolvedValue(new Response(null));
    if (kind === 'network') fetcher.mockRejectedValue(new Error('private network information'));
    await operation.start(local());
    expect(operation.progress).toMatchObject({
      state: 'failed',
      message: expect.not.stringContaining('private'),
    });
    expect(await fs.readFile(operation.modelPath, 'utf8')).toBe('old model');
    expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([
      VOICE_MODELS['tiny.en'].filename,
    ]);
  });
  it('exposes real progress, deduplicates concurrent starts, and cancels a stalled stream with cleanup', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value;
      },
      cancel,
    });
    const operation = installer(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)));
    const stop = new AbortController();
    const first = operation.start(local(), 'tiny.en', stop.signal);
    expect(operation.start(local())).toBe(first);
    controller.enqueue(weights.tiny.subarray(0, 3));
    await vi.waitFor(() => expect(operation.progress.downloadedBytes).toBe(3));
    stop.abort();
    await first;
    expect(operation.progress.state).toBe('failed');
    expect(cancel).toHaveBeenCalled();
    expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([]);
  });
  it('rechecks runtime trust before committing a download', async () => {
    qualified.inspectRuntime
      .mockResolvedValueOnce({ qualified: true, message: 'Reviewed' })
      .mockResolvedValueOnce({ qualified: false, message: 'Changed' });
    const operation = installer();
    await operation.start(local());
    expect(operation.progress).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('unsupported'),
    });
    expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([]);
  });
  it('enforces disk headroom before network traffic', async () => {
    vi.mocked(fs.statfs).mockResolvedValue({ bavail: 1, bsize: 1 } as StatsFs);
    const fetcher = vi.fn<typeof fetch>();
    const operation = installer(fetcher);
    await operation.start(local());
    expect(operation.progress).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('disk space'),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['voice', 'models'])('rejects symlinked private %s directories', async (name) => {
    const target = join(directory, 'outside');
    await fs.mkdir(target);
    if (name === 'voice') await fs.symlink(target, join(directory, 'voice'));
    else {
      await fs.mkdir(join(directory, 'voice'));
      await fs.symlink(target, join(directory, 'voice', 'models'));
    }
    const fetcher = vi.fn<typeof fetch>();
    const operation = installer(fetcher);
    await operation.start(local());
    expect(operation.progress.state).toBe('failed');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await fs.readdir(target)).toEqual([]);
  });
  it.each([
    'https://unapproved.example/model',
    'http://huggingface.co/model',
    'https://user:password@huggingface.co/model',
    'https://huggingface.co:444/model',
    '',
    'loop',
  ])('rejects unsafe or unbounded redirects: %s', async (location) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: location
            ? { location: location === 'loop' ? 'https://huggingface.co/loop' : location }
            : {},
        }),
      ),
    );
    const operation = installer(fetcher);
    await operation.start(local());
    expect(operation.progress.state).toBe('failed');
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
    expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([]);
  });
  it('accepts only the fixed HTTPS model host and reviewed HF asset CDN redirects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cas-bridge.xethub.hf.co/approved-signed-asset' },
        }),
      )
      .mockResolvedValueOnce(new Response(weights.tiny));
    const operation = installer(fetcher);
    await operation.start(local());
    expect(operation.progress.state).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
  });
  it('rejects unapproved model identifiers and preaborted operations', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const operation = installer(fetcher);
    await operation.start(local(), 'https://unapproved.example/model' as VoiceModelId);
    expect(operation.progress.state).toBe('failed');
    const cancelled = new AbortController();
    cancelled.abort();
    await operation.start(local(), 'tiny.en', cancelled.signal);
    expect(operation.progress.state).toBe('failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cleans model partial files even if the download stream fails to cancel', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(Buffer.alloc(weights.tiny.length + 1));
      },
      cancel: () => {
        throw new Error('private cancellation diagnostic');
      },
    });
    const operation = installer(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)));
    await operation.start(local());
    expect(operation.progress.state).toBe('failed');
    expect(await fs.readdir(join(directory, 'voice', 'models'))).toEqual([]);
  });
});
