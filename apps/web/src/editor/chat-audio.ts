import {
  LoopDefinitionSchema,
  ScriptConfigSchema,
  SubloopConfigSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { disableChatAudio, enableChatAudio } from '@graphgoblin/domain';

export type ChatNormalizerKind = 'script' | 'subloop';
export function initialChatNormalizer(kind: ChatNormalizerKind): Record<string, unknown> {
  return kind === 'script'
    ? { command: '', args: [], stdin: 'thread', stdout: 'last-output' }
    : {
        loopRef: { loopId: '' },
        input: { trigger: { payload: 'trigger.payload' } },
        output: { mode: 'result-only', resultTo: { lastOutput: true } },
      };
}
/** Preview the domain's atomic edit without touching the current editor or published definition. */
export function previewChatAudio(
  source: LoopDefinitionInput,
  kind: ChatNormalizerKind,
  config: unknown,
): LoopDefinitionInput {
  const definition = LoopDefinitionSchema.parse(source);
  const base = { id: 'chat-normalize', label: 'Normalize chat input', ui: { x: 260, y: 160 } };
  const node =
    kind === 'script'
      ? { ...base, kind: 'script' as const, config: ScriptConfigSchema.parse(config) }
      : { ...base, kind: 'subloop' as const, config: SubloopConfigSchema.parse(config) };
  if (node.kind === 'script' && !node.config.command.trim())
    throw new Error('Enter the normalizer command.');
  return enableChatAudio(definition, node);
}
export function previewDisableChatAudio(
  source: LoopDefinitionInput,
  continuationNodeId?: string,
): LoopDefinitionInput {
  return disableChatAudio(
    LoopDefinitionSchema.parse(source),
    continuationNodeId ? { continuationNodeId } : undefined,
  );
}
