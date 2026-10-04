import {
  LoopSettingsSchema,
  VariableDeclarationsSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import { FieldGroup, HelpText, Input, Label, Textarea } from '../components/ui/index.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { useEditorStore } from './store.js';

const VariablesFormSchema = z.object({ variables: VariableDeclarationsSchema });

/**
 * Loop name, description, settings, and declared variables (name to JSON Schema). The forms keep
 * their own state: remount this (a `key`) when the definition is replaced, as a load does.
 */
export function LoopSettingsPanel({ definition }: { definition: LoopDefinitionInput }) {
  const { updateMeta, updateSettings, updateVariables, setFieldError } = useEditorStore.getState();
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  return (
    <section aria-label="Loop settings" className="grid gap-field">
      <FieldGroup>
        <Label htmlFor="loop-name">Name</Label>
        <Input
          id="loop-name"
          value={definition.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="loop-description">Description</Label>
        <Textarea
          id="loop-description"
          className="font-sans"
          value={definition.description ?? ''}
          onChange={(e) => updateMeta({ description: e.target.value })}
        />
      </FieldGroup>
      <h3 className="mt-2 text-xs font-semibold tracking-wide text-muted uppercase">Settings</h3>
      <SchemaForm
        schema={LoopSettingsSchema}
        value={definition.settings ?? {}}
        label="Loop settings form"
        onChange={updateSettings}
        parseErrors={fieldErrors['settings']}
        onParseError={(path, error) => setFieldError('settings', path, error)}
      />
      <div className="mt-2 grid gap-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Variables</h3>
        <HelpText>Each variable maps a name to a JSON Schema.</HelpText>
      </div>
      <SchemaForm
        schema={VariablesFormSchema}
        value={{ variables: definition.variables ?? {} }}
        label="Variables form"
        onChange={(value) => updateVariables((value as { variables?: unknown }).variables ?? {})}
        parseErrors={fieldErrors['variables']}
        onParseError={(path, error) => setFieldError('variables', path, error)}
      />
    </section>
  );
}
