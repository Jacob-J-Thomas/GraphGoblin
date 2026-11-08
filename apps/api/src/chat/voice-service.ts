import { createHash, createHmac } from 'node:crypto';
import { freemem, totalmem, arch, platform } from 'node:os';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import {
  CHAT_MAX_TEXT_CHARACTERS,
  VOICE_CONFIG_KEY,
  VOICE_NORMALIZER_COMMAND,
  VoiceConfigSchema,
  VoiceOperationSchema,
  type VoiceOperation,
  ChatLoopInputSchema,
  ChatNormalizedInputSchema,
  ContextThreadSchema,
  JsonValueSchema,
  type VoiceConfig,
  type VoiceProbe,
  type VoiceRouteInfo,
  type VoiceSetup,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import {
  createSystemChatDefinition,
  SYSTEM_CHAT_TEXT_PROMPT,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  enableChatAudio,
  stableHash,
  stableStringify,
  systemChatIssues,
} from '@graphgoblin/domain';
import {
  LocalVoiceInstaller,
  inspectVoiceRuntime,
  inspectVoiceModel,
  type VoiceRuntimeInspection,
  localVoiceFingerprint,
  transcribeLocal,
  transcribeOpenAI,
  readVoiceWav,
  VOICE_MODEL_BYTES,
  VoiceProviderError,
  VoiceNativeScriptError,
} from '@graphgoblin/infrastructure/process';
import type { ScriptPort, ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';
import type {
  SqliteChatRepository,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteSecrets,
  SqliteSettings,
} from '@graphgoblin/infrastructure/sqlite';
import { ChatError } from './errors.js';
import { validateCanonicalChatWav } from './media.js';
import { voiceProbeSample } from './voice-sample.js';

const defaults: VoiceConfig = {
  revision: 0,
  enabled: false,
  mode: 'auto',
  cloudFallbackAllowed: false,
};
const compatibleSecret = (name: string) => /^voice\.openai\.[A-Za-z0-9_.-]+$/.test(name);
const localEvidenceFingerprint = (fingerprint: string) =>
  stableHash([fingerprint, platform(), arch(), totalmem()]);
function standardTextDefinition(definition: LoopDefinition): boolean {
  const respond = definition.nodes.find((node) => node.id === 'respond');
  if (respond?.kind !== 'inference') return false;
  const expected = createSystemChatDefinition({
    name: definition.name,
    harness: respond.config.harness,
  });
  const project = (value: LoopDefinition) => {
    const next = structuredClone(value);
    delete next.description;
    for (const node of next.nodes) {
      node.label = '';
      node.ui = { x: 0, y: 0 };
      if (node.kind === 'inference' && node.id === 'respond') {
        delete node.config.model;
        delete node.config.effort;
        delete node.config.timeoutSeconds;
      }
    }
    return next;
  };
  return stableStringify(project(definition)) === stableStringify(project(expected));
}
/** The voice application service depends on its ports, never on the composition root. */
export interface VoiceServiceDependencies {
  config: { dataDir: string };
  masterKey: Buffer;
  ports: { ids: { next(): string } };
  repos: {
    settings: Pick<
      SqliteSettings,
      | 'get'
      | 'set'
      | 'beginVoiceOperation'
      | 'compareVoiceConfig'
      | 'getVoiceProbeState'
      | 'saveVoiceProbe'
      | 'quarantineVoiceProbe'
    >;
    secretsFor(ownerId: string): Pick<SqliteSecrets, 'resolve' | 'list'>;
    loops: Pick<SqliteLoopRepository, 'getLoop' | 'getVersion' | 'listLoops'>;
    chat: Pick<SqliteChatRepository, 'getAudio'>;
    runs: Pick<SqliteRunRepository, 'get' | 'getInitialThread'>;
  };
}
export class VoiceService {
  readonly installer: LocalVoiceInstaller;
  private readonly activeOperations = new Set<string>();
  private activeInstall: string | undefined;
  private readonly jobs = new Set<Promise<void>>();
  private readonly setupAbort = new AbortController();
  stop(): void {
    this.setupAbort.abort();
  }
  async close(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.jobs]);
  }
  constructor(
    private readonly container: VoiceServiceDependencies,
    private readonly scripts: ScriptPort,
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: {
      inspectModel?: (path: string) => Promise<VoiceRuntimeInspection>;
      freeMemoryBytes?: () => number;
    } = {},
  ) {
    this.installer = new LocalVoiceInstaller(container.config.dataDir, scripts, fetcher, {
      inspectRuntime: (executable) => inspectVoiceRuntime(container.config.dataDir, executable),
    });
  }
  private freeMemory(): number {
    return (this.options.freeMemoryBytes ?? freemem)();
  }
  async operation(ownerId: string, id: string, kind: 'probe' | 'install'): Promise<VoiceOperation> {
    const raw = await this.container.repos.settings.get(ownerId, `chat.voice.operation.${id}`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('result' in raw))
      throw new ChatError('CHAT_NOT_FOUND', 404, 'Voice operation not found.');
    let result = VoiceOperationSchema.parse(raw.result);
    if (result.kind !== kind)
      throw new ChatError('CHAT_NOT_FOUND', 404, 'Voice operation not found.');
    if (result.state === 'running' && !this.activeOperations.has(`${ownerId}:${id}`)) {
      result = { ...result, state: 'failed', code: 'VOICE_OPERATION_INTERRUPTED' };
      await this.container.repos.settings.set(
        ownerId,
        `chat.voice.operation.${id}`,
        JsonValueSchema.parse({ ...raw, result }),
      );
    }
    if (result.state === 'running' && kind === 'install')
      result = {
        ...result,
        install: {
          phase: this.installer.progress.phase,
          downloadedBytes: this.installer.progress.downloadedBytes,
          ...(this.installer.progress.totalBytes
            ? { totalBytes: this.installer.progress.totalBytes }
            : {}),
        },
      };
    return result;
  }
  async startOperation(
    ownerId: string,
    id: string,
    kind: 'probe' | 'install',
    parameters: unknown,
    execute: () => Promise<Partial<VoiceOperation>>,
  ): Promise<VoiceOperation> {
    const hash = createHash('sha256')
      .update(stableStringify(JsonValueSchema.parse(parameters)))
      .digest('hex');
    const result: VoiceOperation = { operationId: id, kind, state: 'running' };
    const key = `chat.voice.operation.${id}`;
    const accepted = await this.container.repos.settings.beginVoiceOperation(
      ownerId,
      id,
      JsonValueSchema.parse({ hash, result }),
    );
    if (accepted === 'capacity')
      throw new ChatError(
        'VOICE_OPERATION_CAPACITY',
        429,
        'Voice setup operation history is full. Existing operation checks remain available; ask the owner to review retention before starting another test or install.',
      );
    if (!accepted) {
      const raw = await this.container.repos.settings.get(ownerId, key);
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        !('hash' in raw) ||
        raw.hash !== hash
      )
        throw new ChatError(
          'VOICE_OPERATION_CONFLICT',
          409,
          'This operation identity names different parameters.',
        );
      return this.operation(ownerId, id, kind);
    }
    this.activeOperations.add(`${ownerId}:${id}`);
    const job = execute()
      .then(async (value) => {
        await this.container.repos.settings.set(
          ownerId,
          key,
          JsonValueSchema.parse({ hash, result: { ...result, ...value, state: 'succeeded' } }),
        );
      })
      .catch(async (error) => {
        await this.container.repos.settings.set(
          ownerId,
          key,
          JsonValueSchema.parse({
            hash,
            result: {
              ...result,
              state: 'failed',
              code:
                error instanceof ChatError || error instanceof VoiceProviderError
                  ? error.code
                  : 'VOICE_OPERATION_FAILED',
            },
          }),
        );
      })
      .finally(() => this.activeOperations.delete(`${ownerId}:${id}`))
      .catch(() => undefined);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
    return result;
  }
  async startProbe(
    ownerId: string,
    body: {
      operationId: string;
      route: 'local' | 'cloud';
      expectedConfigRevision: number;
      cloudUploadAcknowledged?: boolean | undefined;
    },
  ): Promise<VoiceOperation> {
    if (body.route === 'cloud' && !body.cloudUploadAcknowledged)
      throw new ChatError(
        'VOICE_CLOUD_DISCLOSURE_REQUIRED',
        400,
        'Confirm the public sample upload and provider billing before testing.',
      );
    return this.startOperation(ownerId, body.operationId, 'probe', body, async () => ({
      probe: await this.probe(
        ownerId,
        body.route,
        body.expectedConfigRevision,
        body.cloudUploadAcknowledged,
      ),
    }));
  }
  async startInstall(
    ownerId: string,
    body: { operationId: string; expectedConfigRevision: number; modelId: 'tiny.en' | 'base.en' },
  ): Promise<VoiceOperation> {
    const config = await this.config(ownerId);
    if (config.revision !== body.expectedConfigRevision)
      throw new ChatError('VOICE_CONFIG_STALE', 409, 'Refresh voice settings before installing.');
    return this.startOperation(ownerId, body.operationId, 'install', body, async () => {
      if (this.activeInstall || this.installer.progress.state === 'installing')
        throw new ChatError(
          'VOICE_INSTALL_BUSY',
          409,
          'Check the existing model installation before starting another.',
        );
      this.activeInstall = body.operationId;
      try {
        const setup = await this.setup(ownerId);
        if ((await this.config(ownerId)).revision !== body.expectedConfigRevision)
          throw new ChatError(
            'VOICE_CONFIG_STALE',
            409,
            'Voice settings changed before installation. Refresh and retry explicitly.',
          );
        const local =
          config.local ??
          (setup.local.executable
            ? {
                executable: setup.local.executable,
                modelPath: setup.local.modelPath ?? this.installer.modelPath,
              }
            : undefined);
        await this.installer.start(local, body.modelId, this.setupAbort.signal);
        const progress = this.installer.progress;
        if (progress.state !== 'ready')
          throw new ChatError(
            'VOICE_INSTALL_FAILED',
            409,
            progress.message ?? 'Local model installation failed.',
          );
        return {
          install: {
            phase: progress.phase,
            downloadedBytes: progress.downloadedBytes,
            ...(progress.totalBytes ? { totalBytes: progress.totalBytes } : {}),
          },
        };
      } finally {
        if (this.activeInstall === body.operationId) this.activeInstall = undefined;
      }
    });
  }
  private async localFingerprint(local: NonNullable<VoiceConfig['local']>): Promise<string> {
    const inspection = await this.installer.inspect(local.executable);
    if (!inspection.qualified)
      throw new VoiceProviderError('VOICE_RUNTIME_UNSUPPORTED', inspection.message);
    return localEvidenceFingerprint(
      stableHash([await localVoiceFingerprint(local), inspection.fingerprint ?? 'qualified']),
    );
  }
  private async cloudFingerprint(ownerId: string, config: VoiceConfig): Promise<string> {
    const key = config.cloud
      ? await this.container.repos.secretsFor(ownerId).resolve(config.cloud.secretName)
      : undefined;
    return createHmac('sha256', this.container.masterKey)
      .update(stableStringify([config.cloud ?? null, key ?? 'missing']))
      .digest('hex');
  }
  async config(ownerId: string): Promise<VoiceConfig> {
    const raw = await this.container.repos.settings.get(ownerId, VOICE_CONFIG_KEY);
    return raw ? VoiceConfigSchema.parse(raw) : structuredClone(defaults);
  }
  async probes(ownerId: string): Promise<VoiceProbe[]> {
    const states = await Promise.all(
      (['local', 'cloud'] as const).map((route) =>
        this.container.repos.settings.getVoiceProbeState(ownerId, route),
      ),
    );
    return states.flatMap((state) => (state.probe ? [state.probe] : []));
  }
  async update(
    ownerId: string,
    input: Omit<VoiceConfig, 'revision'> & { expectedRevision: number },
  ): Promise<VoiceSetup> {
    const before = await this.config(ownerId);
    if (input.expectedRevision !== before.revision)
      throw new ChatError(
        'VOICE_CONFIG_STALE',
        409,
        'Voice settings changed. Refresh before saving.',
      );
    if (input.local && (!isAbsolute(input.local.executable) || !isAbsolute(input.local.modelPath)))
      throw new ChatError(
        'VOICE_LOCAL_PATH_INVALID',
        400,
        'Select absolute local runtime and model paths.',
      );
    if (input.cloud && !compatibleSecret(input.cloud.secretName))
      throw new ChatError(
        'VOICE_SECRET_INCOMPATIBLE',
        400,
        'Select a dedicated voice.openai.* transcription secret.',
      );
    const { expectedRevision, ...value } = input;
    if (
      !(await this.container.repos.settings.compareVoiceConfig(
        ownerId,
        expectedRevision,
        JsonValueSchema.parse({ ...value, revision: expectedRevision + 1 }),
      ))
    )
      throw new ChatError(
        'VOICE_CONFIG_STALE',
        409,
        'Voice settings changed. Refresh before saving.',
      );
    return this.setup(ownerId);
  }
  async route(ownerId: string, config?: VoiceConfig): Promise<VoiceRouteInfo> {
    const current = config ?? (await this.config(ownerId));
    const fallback = current.cloudFallbackAllowed;
    if (!current.enabled)
      return {
        ready: false,
        cloudFallbackAllowed: fallback,
        message: 'Set up voice in gateway settings.',
      };
    const probes = await this.probes(ownerId);
    const recent = (route: 'local' | 'cloud', fingerprint: string) =>
      probes.some(
        (probe) =>
          probe.route === route &&
          probe.configRevision === current.revision &&
          probe.suitable &&
          probe.fingerprint === fingerprint &&
          Date.now() - Date.parse(probe.checkedAt) < 7 * 86400_000,
      );
    if (current.mode !== 'cloud' && current.local) {
      try {
        const fingerprint = await this.localFingerprint(current.local);
        if (recent('local', fingerprint))
          return {
            ready: true,
            route: 'local',
            cloudFallbackAllowed: fallback,
            message: 'Local transcription on the gateway; audio stays here.',
          };
      } catch {
        /* choose only before dispatch */
      }
    }
    if (
      current.mode !== 'local' &&
      current.cloud &&
      (current.mode === 'cloud' || fallback) &&
      recent('cloud', await this.cloudFingerprint(ownerId, current)) &&
      (await this.container.repos.secretsFor(ownerId).resolve(current.cloud.secretName))
    )
      return {
        ready: true,
        route: 'cloud',
        cloudProvider: 'OpenAI',
        cloudFallbackAllowed: fallback,
        message:
          'Audio is sent to OpenAI for transcription using the gateway connection. Provider billing applies.',
      };
    return {
      ready: false,
      cloudFallbackAllowed: fallback,
      message:
        'Run the selected voice connection test, or choose another route in gateway settings.',
    };
  }
  async setup(ownerId: string): Promise<VoiceSetup> {
    const config = await this.config(ownerId);
    let local = config.local;
    let available = false;
    if (!local) {
      const candidates = [
        this.installer.executable,
        '/opt/homebrew/bin/whisper-cli',
        '/usr/local/bin/whisper-cli',
      ];
      for (const executable of candidates) {
        try {
          await access(executable, constants.X_OK);
          local = { executable, modelPath: this.installer.modelPath };
          break;
        } catch {
          /*next*/
        }
      }
    }
    let installSupported = false;
    if (local) {
      installSupported = (await this.installer.inspect(local.executable)).qualified;
      try {
        await this.localFingerprint(local);
        available = true;
      } catch {
        /*setup will guide installation/model*/
      }
    }
    return {
      config,
      route: await this.route(ownerId, config),
      local: {
        available,
        installSupported,
        downloadBytes: VOICE_MODEL_BYTES,
        message: available
          ? 'Verified local runtime and selected model file found. Run the representative test.'
          : installSupported
            ? 'Download the small English model for this verified runtime.'
            : 'Local runtime installation is unsupported here. Select a verified existing whisper-cli runtime or connect OpenAI.',
        ...(local ?? {}),
      },
      probes: await this.probes(ownerId),
      secrets: (await this.container.repos.secretsFor(ownerId).list()).map((secret) => ({
        name: secret.name,
        compatible: compatibleSecret(secret.name),
      })),
      install: { ...this.installer.progress },
    };
  }
  async probe(
    ownerId: string,
    route: 'local' | 'cloud',
    expectedRevision: number,
    acknowledged = false,
  ): Promise<VoiceProbe> {
    const config = await this.config(ownerId);
    const observation = await this.container.repos.settings.getVoiceProbeState(ownerId, route);
    if (config.revision !== expectedRevision)
      throw new ChatError('VOICE_CONFIG_STALE', 409, 'Refresh voice settings before testing.');
    if (route === 'cloud' && !acknowledged)
      throw new ChatError(
        'VOICE_CLOUD_DISCLOSURE_REQUIRED',
        400,
        'Confirm that the public sample will be uploaded to OpenAI and provider billing applies.',
      );
    if (route === 'local' && config.local) {
      const model = await (this.options.inspectModel ?? inspectVoiceModel)(config.local.modelPath);
      if (!model.qualified) throw new VoiceProviderError('VOICE_MODEL_UNSUPPORTED', model.message);
    }
    const started = performance.now();
    const fingerprint =
      route === 'local' && config.local
        ? await this.localFingerprint(config.local)
        : await this.cloudFingerprint(ownerId, config);
    let transcript = '';
    let message: string;
    let suitable = false;
    try {
      const wav = voiceProbeSample();
      if (route === 'cloud') {
        if (!config.cloud) throw new Error('missing cloud config');
        const key = await this.container.repos.secretsFor(ownerId).resolve(config.cloud.secretName);
        if (!key) throw new Error('missing secret');
        transcript = await transcribeOpenAI(
          wav,
          key,
          AbortSignal.any([this.setupAbort.signal, AbortSignal.timeout(120_000)]),
          this.fetcher,
        );
      } else {
        if (!config.local) throw new Error('missing local config');
        const directory = join(this.container.config.dataDir, 'voice', 'probes');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `sample-${this.container.ports.ids.next()}.wav`);
        try {
          await writeFile(path, wav, { mode: 0o600 });
          transcript = await transcribeLocal(this.scripts, config.local, path, {
            cwd: directory,
            signal: AbortSignal.any([this.setupAbort.signal, AbortSignal.timeout(120_000)]),
          });
        } finally {
          await rm(path, { force: true });
        }
      }
      suitable =
        new Set(
          (transcript.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) =>
            ['fellow', 'americans', 'ask', 'country'].includes(word),
          ),
        ).size >= 3 && performance.now() - started <= 30_000;
      message = suitable
        ? 'Representative sample passed. This measures current gateway load; retest while your usual local model is running.'
        : 'The sample was too slow or speech was not recognized. Choose Cloud or retest.';
    } catch (error) {
      message =
        error instanceof VoiceProviderError
          ? error.message
          : 'The selected voice connection could not complete the sample. Check its configuration and try again.';
    }
    const probe: VoiceProbe = {
      route,
      configRevision: config.revision,
      checkedAt: new Date().toISOString(),
      fingerprint,
      suitable,
      latencyMs: Math.round(performance.now() - started),
      freeMemoryBytes: this.freeMemory(),
      message,
      ...(transcript ? { transcript: transcript.slice(0, CHAT_MAX_TEXT_CHARACTERS) } : {}),
    };
    const currentFingerprint =
      route === 'local' && config.local
        ? await this.localFingerprint(config.local)
        : await this.cloudFingerprint(ownerId, config);
    if (
      currentFingerprint !== fingerprint ||
      !(await this.container.repos.settings.saveVoiceProbe(ownerId, probe, observation.generation))
    )
      throw new ChatError(
        'VOICE_PROBE_STALE',
        409,
        'Voice settings or local health changed during this test. Run a new explicit test.',
      );
    return probe;
  }
  async loops(ownerId: string) {
    const result = [];
    for (const loop of await this.container.repos.loops.listLoops(ownerId)) {
      if (!loop.system?.kind || loop.system.kind !== 'chat') continue;
      const version = await this.container.repos.loops.getVersion(
        loop.draftVersionId ?? loop.currentVersionId ?? '',
      );
      if (!version) continue;
      const normalizer = version.definition.nodes.find((node) => node.id === 'chat-normalize');
      let classification: 'standard' | 'customized' | 'current' = 'customized';
      if (!normalizer && standardTextDefinition(version.definition)) classification = 'standard';
      if (
        normalizer?.kind === 'script' &&
        normalizer.config.command === VOICE_NORMALIZER_COMMAND &&
        normalizer.config.env?.GG_VOICE_CONFIG === JSON.stringify(await this.config(ownerId)) &&
        !systemChatIssues(version.definition).length
      )
        classification = 'current';
      result.push({
        loopId: loop.id,
        definitionHash: stableHash(version.definition),
        published: version.status === 'published',
        hasNormalizer: !!normalizer,
        classification,
        label: loop.name,
      });
    }
    return result;
  }
  async preview(ownerId: string, loopId: string, expectedHash: string, expectedRevision: number) {
    const config = await this.config(ownerId);
    if (config.revision !== expectedRevision)
      throw new ChatError('VOICE_CONFIG_STALE', 409, 'Refresh voice settings before previewing.');
    const loop = await this.container.repos.loops.getLoop(loopId);
    if (!loop || loop.ownerId !== ownerId || loop.system?.kind !== 'chat')
      throw new ChatError('CHAT_NOT_FOUND', 404, 'Chat loop not found.');
    const version = await this.container.repos.loops.getVersion(
      loop.draftVersionId ?? loop.currentVersionId ?? '',
    );
    if (!version || stableHash(version.definition) !== expectedHash)
      throw new ChatError(
        'VOICE_DRAFT_STALE',
        409,
        'The loop changed. Refresh and review a new preview.',
      );
    const definition = structuredClone(version.definition);
    const existing = definition.nodes.find((node) => node.id === 'chat-normalize');
    if (
      existing &&
      (existing.kind !== 'script' || existing.config.command !== VOICE_NORMALIZER_COMMAND)
    )
      throw new ChatError(
        'VOICE_CUSTOM_NORMALIZER',
        409,
        'This loop has a custom normalizer. Review it in the editor; the preset will not replace it.',
      );
    const respond = definition.nodes.find((node) => node.id === 'respond');
    const prompt = respond?.kind === 'inference' ? respond.config.prompt.template : undefined;
    const directlyNormalized =
      prompt !== undefined &&
      /\{\{\s*outputs\[['"]chat-normalize['"]\]\.value\.text\s*\}\}/.test(prompt) &&
      !/\btrigger\s*(?:\.\s*payload|\[\s*['"]payload['"]\s*\])\s*(?:\.\s*input|\[\s*['"]input['"]\s*\])/.test(
        prompt,
      );
    if (
      prompt !== SYSTEM_CHAT_TEXT_PROMPT &&
      prompt !== SYSTEM_CHAT_SCRIPT_PROMPT &&
      !directlyNormalized
    )
      throw new ChatError(
        'VOICE_PRESET_PROMPT_UNSUPPORTED',
        409,
        'Review the respond prompt in the editor so it reads the canonical normalized text before adding voice. Update an older standard text loop first.',
      );
    if (existing && respond?.kind === 'inference' && prompt === SYSTEM_CHAT_TEXT_PROMPT)
      respond.config.prompt.template = SYSTEM_CHAT_SCRIPT_PROMPT;

    const normalizer = {
      id: 'chat-normalize',
      kind: 'script' as const,
      label: 'Normalize voice',
      ui: { x: 160, y: 0 },
      config: {
        command: VOICE_NORMALIZER_COMMAND,
        args: [],
        cwd: 'workspace',
        stdin: 'thread' as const,
        stdout: 'last-output' as const,
        env: { GG_VOICE_CONFIG: JSON.stringify(config) },
        timeoutSeconds: 125,
      },
    };
    let next: LoopDefinition;
    if (existing?.kind === 'script') {
      definition.nodes[definition.nodes.indexOf(existing)] = {
        ...existing,
        config: {
          ...existing.config,
          env: { ...existing.config.env, GG_VOICE_CONFIG: JSON.stringify(config) },
        },
      };
      next = definition;
    } else next = enableChatAudio(definition, normalizer);
    if (systemChatIssues(next).length)
      throw new ChatError(
        'VOICE_PREVIEW_INVALID',
        409,
        'The preset cannot safely edit this loop. Review it in the editor.',
      );
    return {
      loopId,
      baseHash: expectedHash,
      configRevision: config.revision,
      previewHash: stableHash(next),
      definition: next,
      message:
        'Review this exact draft change. Staging does not publish it or update any other device loop.',
    };
  }
  async normalize(request: ScriptRunRequest): Promise<ScriptRunResult> {
    let attemptedLocal: { ownerId: string; revision: number; fingerprint: string } | undefined;
    const fail = (code: string): ScriptRunResult => ({
      state: 'completed',
      exitCode: 1,
      stdout: '',
      stderr: code,
      stdoutBytes: 0,
      stderrBytes: Buffer.byteLength(code),
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    });
    try {
      const thread = ContextThreadSchema.parse(JSON.parse(request.stdin ?? ''));
      const run = await this.container.repos.runs.get(thread.run.id);
      if (!run || run.versionId !== thread.run.versionId || run.loopId !== thread.run.loopId)
        return fail('VOICE_RUN_INVALID');
      const version = await this.container.repos.loops.getVersion(run.versionId);
      const helper = version?.definition.nodes.find((node) => node.id === 'chat-normalize');
      if (
        helper?.kind !== 'script' ||
        helper.config.command !== VOICE_NORMALIZER_COMMAND ||
        helper.config.env?.GG_VOICE_CONFIG !== request.env.GG_VOICE_CONFIG ||
        request.args.length
      )
        return fail('VOICE_HELPER_INVALID');
      const input = ChatLoopInputSchema.parse(thread.invocation.trigger.payload);
      const initial = await this.container.repos.runs.getInitialThread(run.id);
      if (
        !initial ||
        stableStringify(initial.invocation.trigger.payload) !==
          stableStringify(thread.invocation.trigger.payload) ||
        stableStringify(initial.invocation.caller) !== stableStringify(thread.invocation.caller)
      )
        return fail('VOICE_INPUT_CHANGED');
      let text: string;
      if (input.input.kind === 'text') text = input.input.text;
      else {
        const config = VoiceConfigSchema.parse(JSON.parse(request.env.GG_VOICE_CONFIG ?? ''));
        const live = await this.config(run.ownerId);
        if (
          !live.enabled ||
          live.revision !== config.revision ||
          stableStringify(live) !== stableStringify(config)
        )
          return fail('VOICE_CONFIG_CHANGED');
        const source = input.input.audio;
        const audio = await this.container.repos.chat.getAudio(
          {
            ownerId: run.ownerId,
            audienceKey:
              thread.invocation.caller?.kind === 'system' &&
              thread.invocation.caller.id.startsWith('chat-device:')
                ? `device:${thread.invocation.caller.id.slice(12)}`
                : 'gateway',
          },
          source.id,
        );
        if (
          !audio ||
          audio.path !== source.path ||
          audio.bytes !== source.bytes ||
          audio.mimeType !== 'audio/wav' ||
          audio.state !== 'consumed'
        )
          return fail('VOICE_AUDIO_UNAVAILABLE');
        const wav = await readVoiceWav(audio.path);
        validateCanonicalChatWav(wav);
        if (createHash('sha256').update(wav).digest('hex') !== audio.sha256)
          return fail('VOICE_AUDIO_CHANGED');
        const route = await this.route(run.ownerId, config);
        if (!route.ready) return fail('VOICE_NOT_READY');
        await this.container.repos.settings.set(
          run.ownerId,
          `chat.voice.route.${run.id}`,
          JsonValueSchema.parse(route),
        );
        // Route is pinned before any provider dispatch. Failure returns this turn's error; never replay elsewhere.
        let transcript: string;
        if (route.route === 'local' && config.local) {
          attemptedLocal = {
            ownerId: run.ownerId,
            revision: config.revision,
            fingerprint: await this.localFingerprint(config.local),
          };
          transcript = await transcribeLocal(this.scripts, config.local, audio.path, request);
        } else if (config.cloud) {
          const key = await this.container.repos
            .secretsFor(run.ownerId)
            .resolve(config.cloud.secretName);
          if (!key) return fail('VOICE_SECRET_MISSING');
          transcript = await transcribeOpenAI(wav, key, request.signal, this.fetcher);
        } else return fail('VOICE_NOT_READY');
        text = input.input.caption ? `${input.input.caption}\n\n${transcript}` : transcript;
      }
      const normalized = ChatNormalizedInputSchema.parse({ text });
      const stdout = JSON.stringify(normalized);
      return {
        state: 'completed',
        exitCode: 0,
        stdout,
        stderr: '',
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: 0,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
      };
    } catch (error) {
      const failedLocal = attemptedLocal;
      if (
        failedLocal &&
        error instanceof VoiceProviderError &&
        error.code === 'VOICE_LOCAL_FAILED' &&
        (!request.signal.aborted ||
          (error instanceof VoiceNativeScriptError &&
            (error.nativeResult.terminationUnconfirmed ||
              error.nativeResult.state === 'outcome-uncertain')))
      ) {
        await this.container.repos.settings
          .quarantineVoiceProbe(
            failedLocal.ownerId,
            failedLocal.revision,
            failedLocal.fingerprint,
            'Local transcription failed. Run the local sample test again before using this route.',
          )
          .catch(() => undefined);
      }
      if (error instanceof VoiceNativeScriptError) return error.nativeResult;
      return fail(error instanceof VoiceProviderError ? error.code : 'VOICE_NORMALIZATION_FAILED');
    }
  }
}
export class VoiceScripts implements ScriptPort {
  constructor(
    private readonly delegate: ScriptPort,
    private readonly voice: VoiceService,
  ) {}
  run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    return request.command === VOICE_NORMALIZER_COMMAND
      ? this.voice.normalize(request)
      : this.delegate.run(request);
  }
}
