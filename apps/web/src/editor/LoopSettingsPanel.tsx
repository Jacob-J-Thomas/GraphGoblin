import {
  LoopSettingsSchema,
  VariableDeclarationsSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import { Input, Label, Textarea } from '../components/ui.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { useEditorStore } from './store.js';

const VariablesFormSchema = z.object({ variables: VariableDeclarationsSchema });

/** Loop name, description, settings, and declared variables (name to JSON Schema). */
export function LoopSettingsPanel({
  definition,
  epoch,
}: {
  definition: LoopDefinitionInput;
  epoch: number;
}) {
  const { updateMeta, updateSettings, updateVariables, setFieldErrors } = useEditorStore.getState();
  return (
    <section aria-label="Loop settings">
      <div className="mb-2">
        <Label htmlFor="loop-name">Name</Label>
        <Input
          id="loop-name"
          value={definition.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
        />
      </div>
      <div className="mb-2">
        <Label htmlFor="loop-description">Description</Label>
        <Textarea
          id="loop-description"
          className="font-sans"
          value={definition.description ?? ''}
          onChange={(e) => updateMeta({ description: e.target.value })}
        />
      </div>
      <h3 className="mt-3 mb-1 text-xs font-semibold text-slate-600 uppercase">Settings</h3>
      <SchemaForm
        key={`settings:${epoch}`}
        schema={LoopSettingsSchema}
        value={definition.settings ?? {}}
        label="Loop settings form"
        onChange={updateSettings}
        onParseErrors={(errors) => setFieldErrors('settings', errors)}
      />
      <h3 className="mt-3 mb-1 text-xs font-semibold text-slate-600 uppercase">Variables</h3>
      <p className="mb-1 text-xs text-slate-500">Each variable maps a name to a JSON Schema.</p>
      <SchemaForm
        key={`variables:${epoch}`}
        schema={VariablesFormSchema}
        value={{ variables: definition.variables ?? {} }}
        label="Variables form"
        onChange={(value) => updateVariables((value as { variables?: unknown }).variables ?? {})}
        onParseErrors={(errors) => setFieldErrors('variables', errors)}
      />
    </section>
  );
}
