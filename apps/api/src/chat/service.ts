import { createHash } from 'node:crypto';
import {
  CHAT_MAX_AUDIO_BYTES,
  CHAT_MAX_HISTORY_CHARACTERS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_TEXT_CHARACTERS,
  CHAT_PROTOCOL,
  type ChatHistoryMessage,
  type ChatLoopInput,
  type ChatReadiness,
  type ChatSendRequest,
  type ChatSession,
  type ChatTurn,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import {
  DomainError,
  parseChatNormalizedInput,
  parseChatResult,
  stableStringify,
  systemChatCapabilities,
  systemChatIssues,
} from '@graphgoblin/domain';
import { ChatRepositoryError, type ChatStoredTurn } from '@graphgoblin/infrastructure/sqlite';
import { ChatAdmissionError, EngineRequestError } from '@graphgoblin/engine';
import type { Container } from '../container.js';
import type { AuthContext } from '../plugins/auth.js';
import { loopPublicationIssues } from '../loop-issues.js';
import { modelIssues } from '../model-issues.js';
import { readinessOperation } from '../readiness-operation.js';
import { assertRunReadiness, RunReadinessError } from '../run-readiness.js';
import { ChatError } from './errors.js';

export function chatScope(auth: AuthContext): { ownerId: string; audienceKey: string } {
  return {
    ownerId: auth.ownerId,
    audienceKey: auth.deviceId ? `device:${auth.deviceId}` : 'gateway',
  };
}

export function chatRequestHash(input: ChatSendRequest['input']): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

const unavailable = (code: string, message: string) => ({
  ready: false,
  code,
  message: message.slice(0, 1000),
});
const blocksChat = (issue: { severity: string; code: string }) =>
  issue.severity === 'error' ||
  /^(?:HARNESS_READINESS_|MODEL_|EFFORT_|CLASSIFIER_)/.test(issue.code);

/** Chat is a constrained native-run gateway. The native admission transaction owns correctness. */
export class ChatService {
  constructor(private readonly container: Container) {}

  async published(auth: AuthContext) {
    const { chat, loops } = this.container.repos;
    const binding = await chat.getBinding(chatScope(auth));
    const loop = binding ? await loops.getLoop(binding.loopId) : undefined;
    const version = loop?.currentVersionId
      ? await loops.getVersion(loop.currentVersionId)
      : undefined;
    if (!loop || loop.ownerId !== auth.ownerId || !version || version.status !== 'published')
      throw new ChatError('CHAT_NOT_READY', 409, 'the bound chat loop needs a published version');
    return { loop, version };
  }

  async readiness(auth: AuthContext): Promise<{ readiness: ChatReadiness; loopId?: string }> {
    let current: Awaited<ReturnType<ChatService['published']>>;
    try {
      current = await this.published(auth);
    } catch (error) {
      if (!(error instanceof ChatError)) throw error;
      const reason = unavailable(error.code, error.message);
      return { readiness: { text: reason, audio: reason } };
    }
    const readiness = readinessOperation(this.container.ports.harnesses);
    const issues = [];
    const pending = [{ loopId: current.loop.id, version: current.version, depth: 0 }];
    const visited = new Set([current.version.id]);
    for (const item of pending) {
      issues.push(
        ...(await loopPublicationIssues(
          this.container,
          auth.ownerId,
          item.version.definition,
          item.loopId,
          readiness,
        )),
      );
      for (const node of item.version.definition.nodes) {
        if (
          node.kind !== 'subloop' ||
          item.depth + 1 >
            (node.config.depthLimitOverride ?? item.version.definition.settings.subloopDepthLimit)
        )
          continue;
        const ref = node.config.loopRef;
        const childLoop = await this.container.repos.loops.getLoop(ref.loopId);
        if (childLoop?.ownerId !== auth.ownerId) continue;
        const child =
          ref.version === 'latest'
            ? await this.container.repos.loops.getLatestPublished(ref.loopId)
            : await this.container.repos.loops.getPublished(ref.loopId, ref.version);
        if (child && !visited.has(child.id)) {
          visited.add(child.id);
          pending.push({ loopId: childLoop.id, version: child, depth: item.depth + 1 });
        }
      }
    }
    const boundary = systemChatIssues(current.version.definition);
    const problem = [...boundary, ...issues].find(blocksChat);
    const text = problem
      ? unavailable(
          problem.code === 'MODEL_UNAVAILABLE' ? problem.code : 'CHAT_NOT_READY',
          problem.message,
        )
      : { ready: true };
    const audio = systemChatCapabilities(current.version.definition).audio
      ? text.ready
        ? { ready: true, message: 'Configured by loop' }
        : text
      : unavailable(
          'CHAT_AUDIO_UNAVAILABLE',
          'configure chat-normalize in the published system loop to enable audio',
        );
    return { readiness: { text, audio }, loopId: current.loop.id };
  }

  async session(auth: AuthContext): Promise<ChatSession> {
    const { readiness, loopId } = await this.readiness(auth);
    const device = auth.deviceId
      ? (await this.container.repos.chat.listDevices(auth.ownerId)).find(
          (entry) => entry.id === auth.deviceId,
        )
      : undefined;
    return {
      audience: auth.deviceId ? { kind: 'device', deviceId: auth.deviceId } : { kind: 'gateway' },
      label: device?.label ?? 'Gateway',
      readiness,
      limits: { maxTextCharacters: CHAT_MAX_TEXT_CHARACTERS, maxAudioBytes: CHAT_MAX_AUDIO_BYTES },
      ...(!auth.deviceId && loopId ? { systemLoopId: loopId } : {}),
    };
  }

  async project(stored: ChatStoredTurn): Promise<ChatTurn> {
    if (stored.historyDeleted || !stored.input)
      throw new ChatError('CHAT_HISTORY_DELETED', 410, 'this turn history was deleted');
    const run = await this.container.repos.runs.get(stored.runId);
    if (!run) throw new ChatError('CHAT_HISTORY_DELETED', 410, 'this turn history was deleted');
    const turn: ChatTurn = {
      id: stored.id,
      conversationId: stored.conversationId,
      requestId: stored.requestId,
      turn: stored.turn,
      runId: stored.runId,
      createdAt: stored.createdAt,
      input: stored.input,
      runStatus: run.status,
    };
    if (
      run.status === 'succeeded' ||
      (stored.input.kind === 'audio' && (run.status === 'failed' || run.status === 'exhausted'))
    ) {
      const pinned = await this.container.repos.loops.getVersion(run.versionId);
      if (!pinned || systemChatIssues(pinned.definition).length) {
        turn.error = {
          code: 'CHAT_RESPONSE_INVALID',
          message: 'the run did not return a valid chat response',
        };
        return turn;
      }
      if (stored.input.kind === 'audio') {
        try {
          const thread = await this.container.manager.getThread(run.id);
          turn.inputTranscript = parseChatNormalizedInput(pinned.definition, thread?.outputs).text;
        } catch {
          turn.error = {
            code: 'CHAT_AUDIO_NORMALIZATION_INVALID',
            message: 'the workflow did not record a valid audio transcript',
          };
          return turn;
        }
      }
    }
    if (run.status === 'succeeded') {
      try {
        turn.response = parseChatResult(run.result);
      } catch {
        turn.error = {
          code: 'CHAT_RESPONSE_INVALID',
          message: 'the run did not return a valid chat response',
        };
      }
    } else if (run.status === 'failed' || run.status === 'exhausted') {
      turn.error = {
        code: run.failure?.code ?? 'CHAT_RUN_FAILED',
        message:
          run.status === 'exhausted'
            ? 'the workflow reached its execution limit'
            : 'the workflow failed; the owner can inspect the native run',
      };
    }
    return turn;
  }

  private async historyPairs(turns: ChatStoredTurn[]): Promise<ChatHistoryMessage[][]> {
    const completed: ChatHistoryMessage[][] = [];
    for (const stored of turns) {
      if (stored.historyDeleted) continue;
      let turn: ChatTurn;
      try {
        turn = await this.project(stored);
      } catch (error) {
        if (error instanceof ChatError && error.code === 'CHAT_HISTORY_DELETED') continue;
        throw error;
      }
      const text = turn.input.kind === 'text' ? turn.input.text : turn.inputTranscript;
      if (turn.response && text)
        completed.push([
          { role: 'user', text },
          { role: 'assistant', text: turn.response.reply },
        ]);
    }
    return completed;
  }

  private boundHistory(completed: ChatHistoryMessage[][]): ChatHistoryMessage[] {
    const pairs = completed.slice(-(CHAT_MAX_HISTORY_MESSAGES / 2));
    let length = pairs.flat().reduce((total, message) => total + message.text.length, 0);
    while (length > CHAT_MAX_HISTORY_CHARACTERS) {
      const removed = pairs.shift()!;
      length -= removed.reduce((total, message) => total + message.text.length, 0);
    }
    return pairs.flat();
  }

  async history(turns: ChatStoredTurn[]): Promise<ChatHistoryMessage[]> {
    return this.boundHistory(await this.historyPairs(turns));
  }

  async send(
    auth: AuthContext,
    conversationId: string,
    request: ChatSendRequest,
  ): Promise<ChatTurn> {
    const { chat } = this.container.repos;
    const scope = chatScope(auth);
    const requestHash = chatRequestHash(request.input);
    const duplicate = await chat.findRequest(scope, conversationId, request.requestId);
    if (duplicate) {
      if (duplicate.requestHash !== requestHash)
        throw new ChatError(
          'CHAT_REQUEST_CONFLICT',
          409,
          'this request id already names a different input',
        );
      return this.project(duplicate);
    }
    try {
      for (let attempt = 0; ; attempt++) {
        const context = await chat.context(scope, conversationId);
        if (!context) throw new ChatError('CHAT_NOT_FOUND', 404, 'conversation not found');
        if (context.active)
          throw new ChatError('CHAT_BUSY', 409, 'wait for the current turn to finish');
        const { loop, version } = await this.published(auth);
        const definition = version.definition;
        if (systemChatIssues(definition).length)
          throw new ChatError(
            'CHAT_NOT_READY',
            409,
            'the published system chat boundary is invalid',
          );
        if (request.input.kind === 'audio' && !systemChatCapabilities(definition).audio)
          throw new ChatError(
            'CHAT_AUDIO_UNAVAILABLE',
            409,
            'audio is not configured by the published loop',
          );
        let pairs = await this.historyPairs(context.turns);
        let beforeTurn = context.turns[0]?.turn;
        let pageLength = context.turns.length;
        while (
          pairs.length < CHAT_MAX_HISTORY_MESSAGES / 2 &&
          pageLength === 100 &&
          beforeTurn !== undefined
        ) {
          const page = await chat.contextHistory(scope, conversationId, { beforeTurn, limit: 100 });
          pageLength = page.length;
          beforeTurn = page.at(-1)?.turn;
          pairs = [...(await this.historyPairs(page.toReversed())), ...pairs];
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const history = this.boundHistory(pairs);
        let input: ChatLoopInput['input'];
        if (request.input.kind === 'text') input = request.input;
        else {
          const audio = await chat.getAudio(scope, request.input.audioId);
          if (!audio) throw new ChatError('CHAT_NOT_FOUND', 404, 'audio upload not found');
          if (audio.consumedTurnId)
            throw new ChatError('CHAT_AUDIO_CONSUMED', 409, 'this audio upload is already used');
          if (audio.expiresAt <= this.container.ports.clock.now().toISOString())
            throw new ChatError('CHAT_AUDIO_EXPIRED', 410, 'this audio upload expired');
          input = {
            kind: 'audio',
            audio: { id: audio.id, mimeType: audio.mimeType, bytes: audio.bytes, path: audio.path },
          };
        }
        const payload: ChatLoopInput = {
          protocol: CHAT_PROTOCOL,
          conversationId,
          requestId: request.requestId,
          turn: context.conversation.lastTurn + 1,
          input,
          history,
        };
        try {
          const readiness = readinessOperation(this.container.ports.harnesses);
          await this.container.manager.startRun(
            {
              ownerId: auth.ownerId,
              loopId: loop.id,
              versionId: version.id,
              triggerNodeId: 'chat-input',
              source: auth.deviceId || auth.actor.kind === 'api-key' ? 'manual.api' : 'manual.ui',
              caller: auth.actor,
              payload,
              conversationTurn: {
                id: this.container.ports.ids.next(),
                conversationId,
                requestId: request.requestId,
                requestHash,
                expectedLastTurn: context.conversation.lastTurn,
                audienceKey: scope.audienceKey,
                input: request.input,
                ...(request.input.kind === 'audio' ? { audioId: request.input.audioId } : {}),
              },
            },
            async (plan) => {
              this.assertBoundary(plan.root.definition);
              for (const pinned of plan.versions.values()) {
                const issues = await modelIssues(
                  this.container,
                  auth.ownerId,
                  pinned.definition,
                  readiness,
                );
                const issue = issues.find(blocksChat);
                if (issue) throw new ChatError('CHAT_NOT_READY', 409, issue.message.slice(0, 1000));
              }
              await assertRunReadiness(
                plan,
                readiness,
                await this.container.ports.modelCatalog.list(),
              );
            },
          );
          const stored = await chat.findRequest(scope, conversationId, request.requestId);
          if (!stored)
            throw new ChatError(
              'CHAT_ADMISSION_UNCERTAIN',
              503,
              'admission acknowledgement is uncertain; check this request id before retrying',
            );
          return await this.project(stored);
        } catch (error) {
          // A commit may have succeeded before its acknowledgement was lost. Recover only this identity.
          const admitted = await chat.findRequest(scope, conversationId, request.requestId);
          if (admitted) {
            if (admitted.requestHash !== requestHash)
              throw new ChatError(
                'CHAT_REQUEST_CONFLICT',
                409,
                'this request id already names a different input',
              );
            return this.project(admitted);
          }
          if (error instanceof RunReadinessError)
            throw new ChatError(
              'CHAT_NOT_READY',
              409,
              error.issues[0]?.message.slice(0, 1000) ?? 'the harness is not ready',
            );
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'CHAT_STALE_CONTEXT' &&
            attempt === 0
          )
            continue;
          if (
            error instanceof ChatError ||
            error instanceof ChatAdmissionError ||
            error instanceof ChatRepositoryError ||
            error instanceof EngineRequestError ||
            error instanceof DomainError
          )
            throw error;
          throw new ChatError(
            'CHAT_ADMISSION_UNCERTAIN',
            503,
            'admission acknowledgement is uncertain; check this request id before retrying',
          );
        }
      }
    } catch (error) {
      // Another request may have committed this same identity while this one was preparing
      // history/readiness. A duplicate still succeeds even if the current workflow changed.
      const admitted = await chat.findRequest(scope, conversationId, request.requestId);
      if (admitted) {
        if (admitted.requestHash !== requestHash)
          throw new ChatError(
            'CHAT_REQUEST_CONFLICT',
            409,
            'this request id already names a different input',
          );
        return this.project(admitted);
      }
      throw error;
    }
  }

  private assertBoundary(definition: LoopDefinition): void {
    if (systemChatIssues(definition).length)
      throw new ChatError('CHAT_NOT_READY', 409, 'the pinned system chat boundary is invalid');
  }
}
