import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { ScriptPort, ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';
import type { VoiceConfig } from '@graphgoblin/contracts';
import { VOICE_MODELS, type VoiceModelId } from './voice-models.js';

const AUDIO_LIMIT = 10 * 1024 * 1024;
const RESPONSE_LIMIT = 128_000;
const TRANSCRIPT_LIMIT = 16_000;
const TRANSCRIPTION_DEADLINE_MS = 120_000;
const INSTALL_DEADLINE_MS = 300_000;
const DISK_RESERVE_BYTES = 32 * 1024 * 1024;
const unsupported =
  'Local runtime installation is unsupported. Select a verified existing whisper-cli runtime or connect OpenAI in voice settings.';
type LocalVoice = NonNullable<VoiceConfig['local']>;

export const VOICE_MODEL_BYTES = VOICE_MODELS['tiny.en'].bytes;
export class VoiceProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceProviderError';
  }
}

/** Preserve native process safety facts without retaining its diagnostics or partial transcript. */
export class VoiceNativeScriptError extends VoiceProviderError {
  readonly nativeResult: ScriptRunResult;
  constructor(result: ScriptRunResult) {
    super(
      'VOICE_LOCAL_FAILED',
      'Local transcription did not complete. The selected route was not changed.',
    );
    this.name = 'VoiceNativeScriptError';
    this.nativeResult = Object.freeze({
      state: result.state,
      ...(result.terminationUnconfirmed ? { terminationUnconfirmed: true as const } : {}),
      // A clean process exit can still produce rejected/overflowed output; the helper failed.
      exitCode: result.exitCode === 0 ? 1 : result.exitCode,
      stdout: '',
      stderr: this.code,
      stdoutBytes: 0,
      stderrBytes: Buffer.byteLength(this.code),
      timedOut: result.timedOut,
      stdoutOverflow: result.stdoutOverflow,
      stderrOverflow: result.stderrOverflow,
    });
  }
}

function absolutePath(path: string): void {
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new VoiceProviderError(
      'VOICE_LOCAL_PATH_INVALID',
      'Select absolute local runtime and model paths.',
    );
  }
}

/** Filesystem identity, not evidence that an installed runtime or its dependencies are licensed. */
export async function localVoiceFingerprint(config: LocalVoice): Promise<string> {
  absolutePath(config.executable);
  absolutePath(config.modelPath);
  try {
    await access(config.executable, constants.X_OK);
    const [runtime, model, executable, modelPath] = await Promise.all([
      stat(config.executable),
      stat(config.modelPath),
      realpath(config.executable),
      realpath(config.modelPath),
    ]);
    if (!runtime.isFile() || !model.isFile() || model.size < 1) throw new Error('missing files');
    const identity = (value: typeof runtime) => [
      value.dev,
      value.ino,
      value.size,
      value.mtimeMs,
      value.ctimeMs,
    ];
    return createHash('sha256')
      .update(JSON.stringify([executable, identity(runtime), modelPath, identity(model)]))
      .digest('hex');
  } catch {
    throw new VoiceProviderError(
      'VOICE_LOCAL_MISSING',
      'Select an available local voice runtime and model, or connect OpenAI.',
    );
  }
}

function canonicalWav(bytes: Uint8Array): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () =>
    new VoiceProviderError(
      'VOICE_AUDIO_INVALID',
      'Voice requires a complete mono 16 kHz PCM16 WAV of at most 120 seconds.',
    );
  if (
    data.length < 46 ||
    data.length > AUDIO_LIMIT ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.toString('ascii', 12, 16) !== 'fmt ' ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== 16_000 ||
    data.readUInt32LE(28) !== 32_000 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.toString('ascii', 36, 40) !== 'data'
  )
    throw invalid();
  const length = data.readUInt32LE(40);
  if (length !== data.length - 44 || length % 2 !== 0 || length > 120 * 32_000) throw invalid();
}

/** Opens without following a symlink and never reads more than the admitted byte bound. */
export async function readVoiceWav(path: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size > AUDIO_LIMIT || before.size < 46)
      throw new Error('invalid file');
    const bytes = Buffer.alloc(before.size + 1);
    let received = 0;
    while (received < bytes.length) {
      const result = await handle.read(bytes, received, bytes.length - received, received);
      if (result.bytesRead === 0) break;
      received += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      received !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error('changed file');
    const result = bytes.subarray(0, received);
    canonicalWav(result);
    return result;
  } catch {
    throw new VoiceProviderError(
      'VOICE_AUDIO_INVALID',
      'Voice audio is unavailable or is not a complete mono 16 kHz PCM16 WAV.',
    );
  } finally {
    await handle?.close();
  }
}

export async function transcribeLocal(
  scripts: ScriptPort,
  local: LocalVoice,
  path: string,
  request: Pick<ScriptRunRequest, 'cwd' | 'signal'>,
): Promise<string> {
  if (request.signal.aborted)
    throw new VoiceProviderError('VOICE_CANCELLED', 'Voice transcription was cancelled.');
  await localVoiceFingerprint(local);
  await readVoiceWav(path);
  try {
    const result = await scripts.run({
      cwd: request.cwd,
      signal: request.signal,
      command: local.executable,
      args: ['-m', local.modelPath, '-f', path, '-nt', '-np', '-l', 'en', '-t', '4'],
      env: {},
      inheritEnv: false,
      timeoutMs: TRANSCRIPTION_DEADLINE_MS,
      maxStdoutBytes: RESPONSE_LIMIT,
      maxStderrBytes: 4096,
    });
    // Cancellation cannot erase an unconfirmed termination or uncertain process disposition.
    if (result.state !== 'completed' || result.terminationUnconfirmed)
      throw new VoiceNativeScriptError(result);
    if (request.signal.aborted)
      throw new VoiceProviderError('VOICE_CANCELLED', 'Voice transcription was cancelled.');
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.stdoutOverflow ||
      result.stderrOverflow
    ) {
      throw new VoiceNativeScriptError(result);
    }
    const text = result.stdout.trim();
    if (!text)
      throw new VoiceProviderError(
        'VOICE_NO_SPEECH',
        'No speech was found. Record again or send text.',
      );
    if (text.length > TRANSCRIPT_LIMIT)
      throw new VoiceProviderError(
        'VOICE_TRANSCRIPT_TOO_LONG',
        'The transcript is too long. Record a shorter draft.',
      );
    return text;
  } catch (error) {
    if (error instanceof VoiceProviderError) throw error;
    // An unclassified runner rejection cannot prove that the child never executed.
    throw new VoiceNativeScriptError({
      state: 'outcome-uncertain',
      exitCode: null,
      stdout: '',
      stderr: '',
      stdoutBytes: 0,
      stderrBytes: 0,
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    });
  }
}

/** Also bounds adapters that fail to reject a pending fetch/read when their signal aborts. */
async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('voice operation aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => undefined);
}

async function responseBytes(
  response: Response,
  signal: AbortSignal,
  limit: number,
): Promise<Buffer> {
  const length = response.headers.get('content-length');
  if (!response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))) {
    cancelBody(response.body);
    throw new VoiceProviderError(
      'VOICE_CLOUD_INVALID_RESPONSE',
      'The provider returned an invalid or oversized transcript.',
    );
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await abortable(() => reader.read(), signal);
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new VoiceProviderError(
          'VOICE_CLOUD_INVALID_RESPONSE',
          'The provider transcript exceeded the response limit.',
        );
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function transcribeOpenAI(
  wav: Uint8Array,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (signal.aborted)
    throw new VoiceProviderError('VOICE_CANCELLED', 'Voice transcription was cancelled.');
  canonicalWav(wav);
  if (!/^[\x21-\x7e]{1,4096}$/.test(key))
    throw new VoiceProviderError(
      'VOICE_CLOUD_CREDENTIAL_INVALID',
      'Select a valid dedicated voice connection.',
    );
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(TRANSCRIPTION_DEADLINE_MS)]);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav');
  form.set('model', 'gpt-transcribe');
  form.set('response_format', 'json');
  try {
    const response = await abortable(
      () =>
        fetcher('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: deadline,
        }),
      deadline,
    );
    if (!response.ok) {
      cancelBody(response.body);
      throw new VoiceProviderError(
        response.status === 401
          ? 'VOICE_CLOUD_CREDENTIAL_INVALID'
          : response.status === 429
            ? 'VOICE_CLOUD_RATE_LIMITED'
            : 'VOICE_CLOUD_FAILED',
        'Cloud transcription was refused. Check the saved connection and provider billing before retrying.',
      );
    }
    const bytes = await responseBytes(response, deadline, RESPONSE_LIMIT);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new VoiceProviderError(
        'VOICE_CLOUD_INVALID_RESPONSE',
        'The provider returned an invalid transcript.',
      );
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('text' in value) ||
      typeof value.text !== 'string'
    )
      throw new VoiceProviderError(
        'VOICE_CLOUD_INVALID_RESPONSE',
        'The provider returned an invalid transcript.',
      );
    if (!value.text.trim())
      throw new VoiceProviderError('VOICE_NO_SPEECH', 'No usable speech transcript was returned.');
    if (value.text.length > TRANSCRIPT_LIMIT)
      throw new VoiceProviderError(
        'VOICE_TRANSCRIPT_TOO_LONG',
        'The transcript is too long. Record a shorter draft.',
      );
    return value.text;
  } catch (error) {
    if (error instanceof VoiceProviderError) throw error;
    throw new VoiceProviderError(
      'VOICE_CLOUD_OUTCOME_UNCERTAIN',
      'Cloud transcription acknowledgement is uncertain. No provider switch or automatic retry was made.',
    );
  }
}

export interface VoiceInstallProgress {
  state: 'idle' | 'installing' | 'ready' | 'failed';
  phase: string;
  downloadedBytes: number;
  totalBytes?: number;
  message?: string;
}

export interface VoiceRuntimeInspection {
  qualified: boolean;
  message: string;
  fingerprint?: string;
}
export interface VoiceRuntimeFile {
  path: string;
  realpath: string;
  sha256: string;
  license: string;
}
/** Provisioned only by the server operator after build/dependency licence review. */
export interface VoiceRuntimeQualificationRecord {
  formatVersion: 1;
  executable: VoiceRuntimeFile & { version: string };
  dependencies: VoiceRuntimeFile[];
  dependencyDirectories: VoiceRuntimeDirectory[];
  evidence: { id: string; sha256: string };
  qualifiedAt: string;
}
export interface VoiceRuntimeDirectory {
  path: string;
  realpath: string;
  /** Exact inventory of the reviewed loader directory, including symlink targets. */
  entries: { name: string; type: 'file' | 'symlink'; realpath: string; sha256: string }[];
}

const permittedLicenses = new Set([
  'MIT',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function runtimeFile(value: unknown): value is VoiceRuntimeFile {
  return (
    isObject(value) &&
    typeof value.path === 'string' &&
    isAbsolute(value.path) &&
    !value.path.includes('\0') &&
    typeof value.realpath === 'string' &&
    isAbsolute(value.realpath) &&
    !value.realpath.includes('\0') &&
    digest(value.sha256) &&
    typeof value.license === 'string' &&
    permittedLicenses.has(value.license)
  );
}

async function hashRuntimeFile(
  file: Pick<VoiceRuntimeFile, 'path' | 'realpath' | 'sha256'>,
): Promise<void> {
  if ((await realpath(file.path)) !== file.realpath) throw new Error('runtime path changed');
  const handle = await open(file.realpath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > 256 * 1024 * 1024)
      throw new Error('invalid runtime file');
    const hash = createHash('sha256');
    const bytes = Buffer.alloc(64 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > before.size) throw new Error('runtime file grew');
      hash.update(bytes.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (
      size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      hash.digest('hex') !== file.sha256
    )
      throw new Error('runtime changed');
  } finally {
    await handle.close();
  }
}

function runtimeDirectory(value: unknown): value is VoiceRuntimeDirectory {
  if (
    !isObject(value) ||
    typeof value.path !== 'string' ||
    !isAbsolute(value.path) ||
    typeof value.realpath !== 'string' ||
    !isAbsolute(value.realpath) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 256
  )
    return false;
  return value.entries.every(
    (entry: unknown) =>
      isObject(entry) &&
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      entry.name.length <= 255 &&
      entry.name !== '.' &&
      entry.name !== '..' &&
      !/[\\/\0]/.test(entry.name) &&
      (entry.type === 'file' || entry.type === 'symlink') &&
      typeof entry.realpath === 'string' &&
      isAbsolute(entry.realpath) &&
      digest(entry.sha256),
  );
}

async function inspectRuntimeDirectory(directory: VoiceRuntimeDirectory): Promise<void> {
  if ((await realpath(directory.path)) !== directory.realpath)
    throw new Error('loader directory changed');
  const actual = await readdir(directory.realpath, { withFileTypes: true });
  if (
    actual.length > 256 ||
    actual.length !== directory.entries.length ||
    new Set(directory.entries.map((entry) => entry.name)).size !== actual.length
  )
    throw new Error('loader inventory changed');
  for (const entry of actual) {
    const expected = directory.entries.find((file) => file.name === entry.name);
    if (
      !expected ||
      (entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : 'unsupported') !==
        expected.type
    )
      throw new Error('loader entry changed');
    await hashRuntimeFile({
      path: join(directory.realpath, entry.name),
      realpath: expected.realpath,
      sha256: expected.sha256,
    });
  }
}

/** Only the reviewed immutable English model assets qualify for the guided preset. */
export async function inspectVoiceModel(modelPath: string): Promise<VoiceRuntimeInspection> {
  try {
    absolutePath(modelPath);
    const size = (await stat(modelPath)).size;
    const model = Object.values(VOICE_MODELS).find((value) => value.bytes === size);
    if (!model) throw new Error('unsupported model');
    const canonical = await realpath(modelPath);
    await hashRuntimeFile({ path: modelPath, realpath: canonical, sha256: model.sha256 });
    return {
      qualified: true,
      message: 'The local model matches a reviewed MIT English model asset.',
      fingerprint: model.sha256,
    };
  } catch {
    return {
      qualified: false,
      message:
        'Select a verified tiny.en or base.en model, download the supported model, or connect OpenAI.',
    };
  }
}

/** Health/version output cannot qualify a build. Only a matching private operator attestation can. */
export async function inspectVoiceRuntime(
  dataDir: string,
  executable: string,
): Promise<VoiceRuntimeInspection> {
  let handle;
  try {
    absolutePath(executable);
    const path = join(resolve(dataDir), 'voice', 'runtime-qualification.json');
    const parent = await lstat(join(resolve(dataDir), 'voice'));
    if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0)
      throw new Error('private runtime state required');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size < 1 ||
      info.size > 64 * 1024 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('private runtime record required');
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw new Error('runtime record changed');
    const record: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (
      !isObject(record) ||
      record.formatVersion !== 1 ||
      !runtimeFile(record.executable) ||
      !('version' in record.executable) ||
      typeof record.executable.version !== 'string' ||
      !record.executable.version ||
      !Array.isArray(record.dependencies) ||
      record.dependencies.length > 256 ||
      !record.dependencies.every(runtimeFile) ||
      !Array.isArray(record.dependencyDirectories) ||
      record.dependencyDirectories.length > 16 ||
      !record.dependencyDirectories.every(runtimeDirectory) ||
      !isObject(record.evidence) ||
      typeof record.evidence.id !== 'string' ||
      !record.evidence.id ||
      !digest(record.evidence.sha256) ||
      typeof record.qualifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.qualifiedAt))
    )
      throw new Error('invalid runtime qualification');
    if ((await realpath(executable)) !== record.executable.realpath)
      throw new Error('selected runtime is not qualified');
    await access(executable, constants.X_OK);
    for (const file of [record.executable, ...record.dependencies]) await hashRuntimeFile(file);
    for (const directory of record.dependencyDirectories) await inspectRuntimeDirectory(directory);
    return {
      qualified: true,
      message:
        'The selected runtime and reviewed dependency files match the private qualification record.',
      fingerprint: createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex'),
    };
  } catch {
    return { qualified: false, message: unsupported };
  } finally {
    await handle?.close();
  }
}

export interface VoiceInstallerOptions {
  /** Trusted server-side provenance/dependency inspection, never a browser qualification claim. */
  inspectRuntime?: (executable: string) => Promise<VoiceRuntimeInspection>;
}

/** Model downloads only. Runtime/package/source installation is deliberately unsupported. */
export class LocalVoiceInstaller {
  progress: VoiceInstallProgress = {
    state: 'idle',
    phase: 'idle',
    downloadedBytes: 0,
  };
  private operation: Promise<void> | undefined;
  private selectedExecutable = '';
  private model: VoiceModelId = 'tiny.en';
  private readonly root: string;
  get executable(): string {
    return this.selectedExecutable;
  }
  get modelPath(): string {
    return join(this.root, VOICE_MODELS[this.model].filename);
  }

  constructor(
    dataDir: string,
    _scripts: ScriptPort,
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: VoiceInstallerOptions = {},
  ) {
    this.root = join(resolve(dataDir), 'voice', 'models');
  }

  async inspect(executable: string): Promise<VoiceRuntimeInspection> {
    try {
      absolutePath(executable);
      await access(executable, constants.X_OK);
      if (!(await stat(executable)).isFile()) return { qualified: false, message: unsupported };
      const inspection = await this.options.inspectRuntime?.(executable);
      return inspection?.qualified ? inspection : { qualified: false, message: unsupported };
    } catch {
      return { qualified: false, message: unsupported };
    }
  }

  start(
    local?: LocalVoice,
    modelId: VoiceModelId = 'tiny.en',
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    if (this.operation) return this.operation;
    this.progress = { state: 'installing', phase: 'Checking verified runtime', downloadedBytes: 0 };
    this.operation = this.install(local, modelId, signal)
      .then(() => {
        this.progress = {
          ...this.progress,
          state: 'ready',
          phase: 'Model ready; run the local sample test',
        };
      })
      .catch((error: unknown) => {
        this.progress = {
          ...this.progress,
          state: 'failed',
          phase: 'Model download stopped',
          message:
            error instanceof VoiceProviderError
              ? error.message
              : 'Model download failed. The existing model was preserved. Retry or connect OpenAI.',
        };
      })
      .finally(() => {
        this.operation = undefined;
      });
    return this.operation;
  }

  private async privateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe model directory');
    await chmod(path, 0o700);
  }

  private async validModel(path: string, signal: AbortSignal): Promise<boolean> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const model = VOICE_MODELS[this.model];
      const info = await handle.stat();
      if (!info.isFile() || info.size !== model.bytes) return false;
      const hash = createHash('sha256');
      const bytes = Buffer.alloc(64 * 1024);
      for (;;) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, null);
        if (!bytesRead) break;
        hash.update(bytes.subarray(0, bytesRead));
      }
      return hash.digest('hex') === model.sha256;
    } catch {
      return false;
    } finally {
      await handle?.close();
    }
  }

  private async modelResponse(signal: AbortSignal): Promise<Response> {
    const model = VOICE_MODELS[this.model];
    let url = new URL(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${model.revision}/${model.filename}`,
    );
    // HF serves its immutable weights through signed CDN URLs. No credentials are sent.
    const cdnHosts = new Set([
      'huggingface.co',
      'cdn-lfs.huggingface.co',
      'cdn-lfs-us-1.hf.co',
      'cas-bridge.xethub.hf.co',
    ]);
    for (let redirects = 0; ; redirects++) {
      const response = await abortable(
        () => this.fetcher(url.href, { redirect: 'manual', signal }),
        signal,
      );
      if (response.status >= 300 && response.status < 400) {
        cancelBody(response.body);
        const location = response.headers.get('location');
        if (!location || redirects === 3) throw new Error('invalid model redirect');
        const next = new URL(location, url);
        if (
          next.protocol !== 'https:' ||
          next.username ||
          next.password ||
          next.port ||
          !cdnHosts.has(next.hostname)
        )
          throw new Error('unapproved model redirect');
        url = next;
      } else return response;
    }
  }

  private async install(
    local: LocalVoice | undefined,
    modelId: VoiceModelId,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(INSTALL_DEADLINE_MS)]);
    deadline.throwIfAborted();
    if (!Object.hasOwn(VOICE_MODELS, modelId))
      throw new VoiceProviderError(
        'VOICE_MODEL_UNSUPPORTED',
        'Choose the supported tiny.en or base.en model.',
      );
    if (!local || !(await abortable(() => this.inspect(local.executable), deadline)).qualified)
      throw new VoiceProviderError('VOICE_RUNTIME_UNSUPPORTED', unsupported);
    this.selectedExecutable = local.executable;
    this.model = modelId;
    const model = VOICE_MODELS[modelId];
    this.progress.totalBytes = model.bytes;
    await this.privateDirectory(join(this.root, '..'));
    await this.privateDirectory(this.root);
    if (await this.validModel(this.modelPath, deadline)) return;
    const disk = await statfs(this.root);
    if (disk.bavail * disk.bsize < model.bytes + DISK_RESERVE_BYTES)
      throw new VoiceProviderError(
        'VOICE_DISK_FULL',
        'Free disk space before downloading a local model, or connect OpenAI.',
      );
    const temporary = join(this.root, `.${model.filename}-${randomUUID()}.download`);
    let handle;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      this.progress.phase = `Downloading ${modelId} model`;
      const response = await this.modelResponse(deadline);
      const length = response.headers.get('content-length');
      if (
        !response.ok ||
        !response.body ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) !== model.bytes))
      ) {
        cancelBody(response.body);
        throw new Error('invalid model response');
      }
      reader = response.body.getReader();
      const hash = createHash('sha256');
      for (;;) {
        const activeReader = reader;
        const { done, value } = await abortable(() => activeReader.read(), deadline);
        if (done) break;
        this.progress.downloadedBytes += value.length;
        if (this.progress.downloadedBytes > model.bytes)
          throw new Error('model exceeds byte limit');
        hash.update(value);
        await handle.writeFile(value);
      }
      if (this.progress.downloadedBytes !== model.bytes || hash.digest('hex') !== model.sha256)
        throw new Error('model verification failed');
      this.progress.phase = 'Verifying model';
      await handle.sync();
      await handle.close();
      handle = undefined;
      deadline.throwIfAborted();
      if (!(await abortable(() => this.inspect(local.executable), deadline)).qualified)
        throw new VoiceProviderError('VOICE_RUNTIME_UNSUPPORTED', unsupported);
      await rename(temporary, this.modelPath);
    } finally {
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      await handle?.close();
      await rm(temporary, { force: true });
    }
  }
}
