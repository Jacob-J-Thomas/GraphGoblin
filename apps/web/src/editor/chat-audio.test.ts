import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { createSystemChatDefinition, systemChatCapabilities } from '@graphgoblin/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { initialChatNormalizer, previewChatAudio, previewDisableChatAudio } from './chat-audio.js';
import { validateDraft } from './model.js';
import { useEditorStore } from './store.js';
const seed = () => createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' });
const script = { ...initialChatNormalizer('script'), command: 'normalizer', args: ['--json'] };
afterEach(() => useEditorStore.getState().reset());
describe('atomic chat audio authoring', () => {
  it('stages script configuration without touching the source and enables both text and audio through validation', () => {
    const source = seed();
    const copy = structuredClone(source);
    const next = previewChatAudio(source, 'script', script);
    expect(source).toEqual(copy);
    expect(systemChatCapabilities(LoopDefinitionSchema.parse(next)).audio).toBe(true);
    expect(next.nodes.find((node) => node.id === 'chat-normalize')).toMatchObject({
      kind: 'script',
      config: { command: 'normalizer', stdin: 'thread', stdout: 'last-output' },
    });
    expect(next.nodes.some((node) => node.id === 'chat-normalize-check')).toBe(true);
    expect(previewDisableChatAudio(next).nodes).toEqual(source.nodes);
  });
  it('supports an awaited ordinary subloop with the canonical result envelope', () => {
    const next = previewChatAudio(seed(), 'subloop', {
      ...initialChatNormalizer('subloop'),
      loopRef: { loopId: '01J00000000000000000000001' },
    });
    expect(next.nodes.find((node) => node.id === 'chat-normalize')).toMatchObject({
      kind: 'subloop',
      config: {
        output: { mode: 'result-only', resultTo: { lastOutput: true } },
        input: { trigger: { payload: 'trigger.payload' } },
      },
    });
  });
  it('rejects blank commands, invalid policy and incomplete selections before any editor mutation', () => {
    expect(() => previewChatAudio(seed(), 'script', initialChatNormalizer('script'))).toThrow();
    expect(() => previewChatAudio(seed(), 'script', { ...script, command: ' ' })).toThrow(
      'Enter the normalizer command.',
    );
    expect(() => previewChatAudio(seed(), 'script', { ...script, stdin: 'none' })).toThrow();
    expect(() => previewChatAudio(seed(), 'subloop', initialChatNormalizer('subloop'))).toThrow();
    expect(previewDisableChatAudio(seed())).toEqual(seed());
    expect(useEditorStore.getState().definition).toBeUndefined();
  });
  it('applies once to the unchanged draft and undoes/redoes the full chain in one step', () => {
    const store = useEditorStore.getState();
    const source = seed();
    store.load('owner-loop', source);
    const before = useEditorStore.getState();
    const next = previewChatAudio(source, 'script', script);
    expect(before.applyChatAudio(source, next, before, 'enable')).toBeUndefined();
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(useEditorStore.getState().definition).toEqual(next);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().definition).toEqual(source);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().definition).toEqual(next);
    const enabled = useEditorStore.getState();
    expect(
      enabled.applyChatAudio(
        enabled.definition!,
        previewDisableChatAudio(enabled.definition!),
        enabled,
        'disable',
      ),
    ).toBeUndefined();
    expect(useEditorStore.getState().definition?.nodes).toEqual(source.nodes);
    expect(useEditorStore.getState().selectedNodeId).toBe('chat-input');
  });
  it('does not overwrite a draft changed while the configuration dialog was open', () => {
    const source = seed();
    useEditorStore.getState().load('owner-loop', source);
    const expected = useEditorStore.getState();
    const next = previewChatAudio(source, 'script', script);
    useEditorStore.getState().updateMeta({ description: 'Changed elsewhere' });
    expect(useEditorStore.getState().applyChatAudio(source, next, expected, 'enable')).toMatch(
      /draft changed/,
    );
    expect(useEditorStore.getState().definition?.description).toBe('Changed elsewhere');
  });
  it('holds atomic configuration while a field still contains unfinished input', () => {
    const source = seed();
    useEditorStore.getState().load('owner-loop', source);
    useEditorStore.setState({
      fieldErrors: {
        settings: { value: { message: 'unfinished', input: 'unparsed text', text: 'incomplete' } },
      },
    });
    const expected = useEditorStore.getState();
    expect(
      expected.applyChatAudio(
        source,
        previewChatAudio(source, 'script', script),
        expected,
        'enable',
      ),
    ).toMatch(/unfinished fields/);
  });
  it('saves ordinary invalid boundary wiring with inline issues, but holds immutable boundary changes', () => {
    const source = seed();
    const exit = source.nodes.find((node) => node.kind === 'exit')!;
    if (exit.kind !== 'exit') throw new Error('fixture');
    exit.config.returns = 'none';
    const ordinary = validateDraft(source, true);
    expect(ordinary.schemaValid).toBe(true);
    expect(ordinary.issues.some((issue) => issue.code === 'SYSTEM_CHAT_CONTRACT_INVALID')).toBe(
      true,
    );
    source.variables['chatResponse'] = { type: 'number' };
    expect(validateDraft(source, true).schemaValid).toBe(false);
    expect(validateDraft(source, false).schemaValid).toBe(true);
  });
});
