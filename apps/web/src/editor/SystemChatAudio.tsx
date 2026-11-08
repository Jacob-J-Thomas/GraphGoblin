import {
  LoopDefinitionSchema,
  NodeConfigSchemas,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import {
  DomainError,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  SYSTEM_CHAT_SUBLOOP_PROMPT,
  systemChatCapabilities,
} from '@graphgoblin/domain';
import { useState } from 'react';
import {
  Alert,
  Button,
  ChoiceGroup,
  Dialog,
  FieldGroup,
  HelpText,
  Label,
  Select,
} from '../components/ui/index.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import type { ParseError } from '../forms/parse-errors.js';
import {
  initialChatNormalizer,
  previewChatAudio,
  previewDisableChatAudio,
  type ChatNormalizerKind,
} from './chat-audio.js';
import { hasChatVoiceSteps } from './chat-protection.js';
import { SubloopPicker } from './SubloopPicker.js';
import { useEditorStore, type EditorState } from './store.js';
import { SystemChatLockedField } from './SystemChatFields.js';
const reserved = ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'];
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function ScriptPolicy() {
  return (
    <HelpText>
      Reads the thread · writes last output (fixed for voice messages). Successful output continues
      to the protected check; other exit codes fail normally.
    </HelpText>
  );
}
ScriptPolicy.ownsJsonSection = true;
function HiddenPolicy() {
  return null;
}
HiddenPolicy.ownsJsonSection = true;
function SubloopPolicy() {
  return <HelpText>Result only, to last output (fixed for voice messages).</HelpText>;
}
SubloopPolicy.ownsJsonSection = true;
const SCRIPT_FIELDS = { stdin: ScriptPolicy, stdout: HiddenPolicy, exitCodeRoutes: HiddenPolicy };
const SUBLOOP_FIELDS = {
  loopRef: SystemChatLockedField,
  'output.mode': SubloopPolicy,
  'output.resultTo': HiddenPolicy,
  'output.vars': HiddenPolicy,
  'output.messages': HiddenPolicy,
  'output.artifacts': HiddenPolicy,
  'output.custom': HiddenPolicy,
  'output.usage': HiddenPolicy,
};
function SetupVoice({
  definition,
  loopId,
  onClose,
  onAdded,
}: {
  definition: LoopDefinitionInput;
  loopId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [source] = useState(definition);
  const [expected] = useState(() => useEditorStore.getState());
  const [kind, setKind] = useState<ChatNormalizerKind>();
  const [config, setConfig] = useState<unknown>({});
  const [epoch, setEpoch] = useState(0);
  const [held, setHeld] = useState<Record<string, ParseError>>({});
  const [error, setError] = useState<string>();
  const record = asRecord(config);
  const selectedLoop = asRecord(record['loopRef'])['loopId'];
  const reason = !kind
    ? 'Choose Script or Subloop.'
    : kind === 'script' && (typeof record['command'] !== 'string' || !record['command'].trim())
      ? 'Enter the command that produces the transcript.'
      : kind === 'subloop' && (typeof selectedLoop !== 'string' || !selectedLoop)
        ? 'Choose the loop that produces the transcript.'
        : Object.keys(held).length || !NodeConfigSchemas[kind].safeParse(config).success
          ? 'Complete the normalizer configuration.'
          : undefined;
  const apply = () => {
    if (reason || !kind) return;
    try {
      const next = previewChatAudio(source, kind, config);
      const issue = useEditorStore.getState().applyChatAudio(source, next, expected, 'enable');
      if (issue) {
        setError(issue);
        return;
      }
      onAdded();
      onClose();
      useEditorStore.getState().openNode('chat-normalize');
    } catch {
      setError(
        'Couldn’t add voice steps. The chat trigger needs exactly one outgoing connection, and no steps may already use the chat-normalize names.',
      );
    }
  };
  return (
    <Dialog
      open
      title="Set up voice messages"
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <p className="basis-full text-xs text-muted">
            GraphGoblin doesn’t test this step. Voice messages work only if it does.
          </p>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            aria-disabled={Boolean(reason)}
            aria-describedby={reason ? 'voice-setup-reason' : undefined}
            onClick={apply}
          >
            Add voice steps
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          Every chat message, typed or recorded, goes to this step first. It must return{' '}
          {'{"text": "…"}'}: typed text unchanged, recordings transcribed. A protected check
          follows; an invalid result ends the request with no reply.
        </p>
        <ChoiceGroup
          legend="Normalizer"
          choices={(['script', 'subloop'] as const).map((value) => ({
            key: value,
            value,
            label: value === 'script' ? 'Script' : 'Subloop',
            checked: kind === value,
            onSelect: () => {
              setKind(value);
              setConfig(initialChatNormalizer(value));
              setHeld({});
              setError(undefined);
              setEpoch((current) => current + 1);
            },
          }))}
        />
        {kind === 'subloop' ? (
          <SubloopPicker
            currentLoopId={loopId}
            value={typeof selectedLoop === 'string' ? selectedLoop : ''}
            onPick={(id) => {
              setConfig({ ...record, loopRef: { loopId: id } });
              setEpoch((current) => current + 1);
            }}
          />
        ) : null}
        {kind ? (
          <>
            <HelpText>
              {kind === 'script'
                ? 'In the chat input, input.audio.path is the recording’s file and input.text is typed text.'
                : 'That loop must return {"text": "…"}.'}
            </HelpText>
            <SchemaForm
              key={`${kind}:${epoch}`}
              schema={NodeConfigSchemas[kind]}
              value={config}
              label="Voice normalizer configuration"
              fieldOverrides={kind === 'script' ? SCRIPT_FIELDS : SUBLOOP_FIELDS}
              onChange={setConfig}
              parseErrors={held}
              onParseError={(path, issue) =>
                setHeld((current) => {
                  const { [path]: _old, ...rest } = current;
                  return issue ? { ...rest, [path]: issue } : rest;
                })
              }
            />
          </>
        ) : null}
        {reason ? (
          <p id="voice-setup-reason" className="text-sm text-muted">
            {reason}
          </p>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
type HeldContinuation = { source: LoopDefinitionInput; expected: EditorState };
export function SystemChatAudio({
  definition,
  published,
  version,
  loopId,
}: {
  definition: LoopDefinitionInput;
  published: LoopDefinitionInput | undefined;
  version: number | undefined;
  loopId: string;
}) {
  const [setup, setSetup] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [continuation, setContinuation] = useState<HeldContinuation>();
  const [target, setTarget] = useState('');
  const parsed = LoopDefinitionSchema.safeParse(definition);
  const valid = parsed.success && systemChatCapabilities(parsed.data).audio;
  const present = hasChatVoiceSteps(definition);
  const publishedDefinition = published && LoopDefinitionSchema.safeParse(published);
  const publishedAudio =
    publishedDefinition &&
    publishedDefinition.success &&
    systemChatCapabilities(publishedDefinition.data).audio;
  const normalizer = definition.nodes.find((node) => node.id === 'chat-normalize');
  const respond = definition.nodes.find((node) => node.id === 'respond');
  const canonicalPrompt =
    normalizer?.kind === 'subloop' ? SYSTEM_CHAT_SUBLOOP_PROMPT : SYSTEM_CHAT_SCRIPT_PROMPT;
  const guidance =
    present &&
    (respond?.kind !== 'inference' || respond.config.prompt?.template !== canonicalPrompt);
  const disable = (
    source = definition,
    expected = useEditorStore.getState(),
    continuationNodeId?: string,
  ) => {
    setError(undefined);
    try {
      const next = previewDisableChatAudio(source, continuationNodeId);
      const issue = useEditorStore.getState().applyChatAudio(source, next, expected, 'disable');
      if (issue) {
        setError(issue);
        return;
      }
      setContinuation(undefined);
      setStatus('Voice steps removed. Undo restores them.');
    } catch (failure) {
      if (failure instanceof DomainError && failure.code === 'SYSTEM_CHAT_CONTINUATION_REQUIRED') {
        setContinuation({ source, expected });
        setTarget('');
      } else
        setError(
          'Voice setup needs attention. Repair the chat trigger before turning off voice messages.',
        );
    }
  };
  return (
    <div className="basis-full grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {valid
            ? 'Voice messages: chat-normalize handles them.'
            : present
              ? 'Voice setup needs attention.'
              : 'Voice messages: off.'}
        </span>
        {present ? (
          <>
            <Button size="sm" variant="outline" onClick={() => disable()}>
              Turn off voice messages
            </Button>
            {normalizer ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => useEditorStore.getState().openNode('chat-normalize')}
              >
                Edit normalizer
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setSetup(true)}>
            Set up voice messages
          </Button>
        )}
        <span className="text-xs">
          {version
            ? publishedAudio
              ? `Configured by loop in published v${version}.`
              : `Not in published v${version}.`
            : 'Publish this draft to apply voice changes.'}
        </span>
      </div>
      {present ? (
        <HelpText>
          Turning off removes chat-normalize, chat-normalize-check and chat-normalize-invalid.
          Ordinary steps stay. Undo restores the voice steps.
        </HelpText>
      ) : null}
      {guidance ? (
        <HelpText>
          Custom prompts were left unchanged. Check that your workflow reads{' '}
          <code>
            {normalizer?.kind === 'subloop'
              ? 'outputs["chat-normalize"].value.result.text'
              : 'outputs["chat-normalize"].value.text'}
          </code>
          {' for voice messages.'}
        </HelpText>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <p role="status" className="sr-only">
        {status}
      </p>
      {setup ? (
        <SetupVoice
          definition={definition}
          loopId={loopId}
          onClose={() => setSetup(false)}
          onAdded={() => setStatus('Voice steps added. Undo removes them.')}
        />
      ) : null}
      {continuation ? (
        <Dialog
          open
          title="Choose a continuation"
          onClose={() => setContinuation(undefined)}
          footer={
            <>
              <Button variant="outline" onClick={() => setContinuation(undefined)}>
                Cancel
              </Button>
              <Button
                aria-disabled={!target}
                onClick={() => {
                  if (target) disable(continuation.source, continuation.expected, target);
                }}
              >
                Turn off voice messages
              </Button>
            </>
          }
        >
          <FieldGroup>
            <HelpText>
              After the voice steps are removed, chat-input connects to this ordinary step.
            </HelpText>
            <Label htmlFor="voice-continuation">Continue with</Label>
            <Select
              id="voice-continuation"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose a step</option>
              {continuation.source.nodes
                .filter((node) => node.kind !== 'trigger' && !reserved.includes(node.id))
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label} ({node.id})
                  </option>
                ))}
            </Select>
          </FieldGroup>
        </Dialog>
      ) : null}
    </div>
  );
}
