import { createSystemChatDefinition, enableChatAudio } from '@graphgoblin/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasChatAudioBoundary,
  isProtectedVoiceEdge,
  isProtectedVoiceNode,
  VOICE_STEP_MESSAGE,
} from './chat-protection.js';
import { useEditorStore } from './store.js';
const seed = () => createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' });
const audio = () =>
  enableChatAudio(seed(), {
    id: 'chat-normalize',
    label: 'Normalize',
    kind: 'script',
    config: {
      command: 'normalizer',
      args: [],
      cwd: 'workspace',
      stdin: 'thread',
      stdout: 'last-output',
    },
    ui: { x: 0, y: 0 },
  });
afterEach(() => useEditorStore.getState().reset());
describe('voice protocol editor protection', () => {
  it('uses canonical input plus system binding rather than names alone', () => {
    expect(hasChatAudioBoundary(seed())).toBe(false);
    expect(hasChatAudioBoundary({ ...seed(), nodes: [] })).toBe(false);
    expect(hasChatAudioBoundary(audio())).toBe(true);
    expect(isProtectedVoiceNode(audio(), false, 'chat-normalize')).toBe(false);
    expect(isProtectedVoiceNode(seed(), true, 'chat-normalize')).toBe(false);
    expect(isProtectedVoiceNode(audio(), true, 'respond')).toBe(false);
    expect(isProtectedVoiceNode(audio(), true, 'chat-normalize')).toBe(true);
    const orphaned = {
      ...seed(),
      nodes: [...seed().nodes, audio().nodes.find((node) => node.id === 'chat-normalize')!],
    };
    expect(isProtectedVoiceNode(orphaned, true, 'chat-normalize')).toBe(true);
  });
  it('preserves the three internal edges while the valid continuation remains editable', () => {
    const definition = audio();
    const protectedEdges = definition.edges.filter((edge) =>
      isProtectedVoiceEdge(definition, true, edge),
    );
    expect(protectedEdges).toHaveLength(3);
    const valid = definition.edges.find(
      (edge) => edge.from.node === 'chat-normalize-check' && edge.from.port === 'valid',
    )!;
    expect(isProtectedVoiceEdge(definition, true, valid)).toBe(false);
    expect(isProtectedVoiceEdge(definition, false, protectedEdges[0]!)).toBe(false);
    useEditorStore.getState().load('gateway', definition);
    useEditorStore.setState({ systemChat: true });
    for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid']) {
      useEditorStore.getState().removeNode(id);
      useEditorStore.getState().renameNode(id, `${id}-renamed`);
    }
    for (const edge of protectedEdges) useEditorStore.getState().removeEdge(edge.id);
    expect(useEditorStore.getState().definition).toEqual(definition);
    expect(useEditorStore.getState().connectionError).toBe(VOICE_STEP_MESSAGE);
    useEditorStore.getState().removeEdge(valid.id);
    expect(useEditorStore.getState().definition!.edges).toHaveLength(definition.edges.length - 1);
    expect(
      useEditorStore
        .getState()
        .connect({ source: 'chat-normalize-check', sourceHandle: 'valid', target: 'respond' }),
    ).toBeNull();
  });
  it('prevents internal rewiring through every canvas/keyboard connection path', () => {
    const definition = audio();
    useEditorStore.getState().load('gateway', definition);
    useEditorStore.setState({ systemChat: true });
    for (const connection of [
      { source: 'chat-input', sourceHandle: null, target: 'respond' },
      { source: 'chat-normalize', sourceHandle: null, target: 'respond' },
      { source: 'chat-normalize-check', sourceHandle: 'invalid', target: 'respond' },
      { source: 'respond', sourceHandle: null, target: 'chat-normalize' },
    ])
      expect(useEditorStore.getState().connect(connection)).toBe(VOICE_STEP_MESSAGE);
    expect(useEditorStore.getState().definition).toEqual(definition);
  });
  it('ordinary loops retain ordinary rename/delete behavior even with reserved-looking IDs', () => {
    const definition = audio();
    useEditorStore.getState().load('ordinary', definition);
    useEditorStore.getState().renameNode('chat-normalize', 'my-normalizer');
    expect(
      useEditorStore.getState().definition!.nodes.some((node) => node.id === 'my-normalizer'),
    ).toBe(true);
    useEditorStore.getState().removeNode('my-normalizer');
    expect(useEditorStore.getState().definition!.nodes).toHaveLength(definition.nodes.length - 1);
  });
});
