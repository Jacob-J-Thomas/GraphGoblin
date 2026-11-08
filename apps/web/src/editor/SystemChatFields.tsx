import { useId } from 'react';
import { FieldGroup, HelpText, Input, Label } from '../components/ui/index.js';
import { CodeEditor } from '../forms/CodeEditor.js';
import { useField, type FieldProps } from '../forms/fields.js';
import { prettyJson } from '../lib/utils.js';

/** Read-only protocol data remains selectable and uses the same schema-form frame. */
export function SystemChatLockedField({ name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const id = useId();
  return (
    <FieldGroup data-field={name}>
      <Label htmlFor={id}>{label}</Label>
      <CodeEditor
        id={id}
        label={label}
        language="json"
        value={prettyJson(field.value)}
        readOnly
        onChange={() => undefined}
      />
      <HelpText>
        Set by the system chat contract. Configure audio from the system-loop notice.
      </HelpText>
    </FieldGroup>
  );
}
SystemChatLockedField.ownsJsonSection = true;
export function SystemChatTriggerType() {
  const id = useId();
  return (
    <FieldGroup>
      <Label htmlFor={id}>Trigger type</Label>
      <Input id={id} value="Manual" readOnly />
      <HelpText>
        Chat starts this loop through this manual trigger. Its input and exposure are fixed in a
        system chat loop.
      </HelpText>
    </FieldGroup>
  );
}
export const SYSTEM_CHAT_TRIGGER_FIELDS = {
  inputSchema: SystemChatLockedField,
  exposeTo: SystemChatLockedField,
};
export const SYSTEM_CHAT_VARIABLE_FIELDS = { 'variables.chatResponse': SystemChatLockedField };

export const SYSTEM_CHAT_SCRIPT_FIELDS = {
  stdin: SystemChatLockedField,
  stdout: SystemChatLockedField,
  exitCodeRoutes: SystemChatLockedField,
};
export const SYSTEM_CHAT_SUBLOOP_FIELDS = {
  'output.mode': SystemChatLockedField,
  'output.resultTo': SystemChatLockedField,
  'output.vars': SystemChatLockedField,
  'output.messages': SystemChatLockedField,
  'output.artifacts': SystemChatLockedField,
  'output.custom': SystemChatLockedField,
  'output.usage': SystemChatLockedField,
};
