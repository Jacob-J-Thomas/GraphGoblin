import { ChatAudioInputJsonSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
const reserved = ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'];
export const VOICE_STEP_MESSAGE = 'Voice steps stay. Use Turn off voice messages.';
export function hasChatAudioBoundary(definition: LoopDefinitionInput): boolean {
  const trigger = definition.nodes.find((node) => node.id === 'chat-input');
  return (
    trigger?.kind === 'trigger' &&
    trigger.config?.type === 'manual' &&
    stableStringify(trigger.config.inputSchema) === stableStringify(ChatAudioInputJsonSchema)
  );
}
export function hasChatVoiceSteps(definition: LoopDefinitionInput): boolean {
  return (
    hasChatAudioBoundary(definition) || definition.nodes.some((node) => reserved.includes(node.id))
  );
}
export function isProtectedVoiceNode(
  definition: LoopDefinitionInput,
  system: boolean,
  id: string,
): boolean {
  return system && hasChatVoiceSteps(definition) && reserved.includes(id);
}
export function isProtectedVoiceEdge(
  definition: LoopDefinitionInput,
  system: boolean,
  edge: LoopDefinitionInput['edges'][number],
): boolean {
  return (
    system &&
    hasChatVoiceSteps(definition) &&
    (edge.from.node === 'chat-input' ||
      edge.from.node === 'chat-normalize' ||
      (edge.from.node === 'chat-normalize-check' && edge.from.port === 'invalid'))
  );
}
