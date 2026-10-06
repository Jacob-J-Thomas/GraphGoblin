import {
  LoopDefinitionSchema,
  LoopSettingsSchema,
  VariableDeclarationsSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import {
  FieldGroup,
  HelpText,
  Input,
  Label,
  RequiredNote,
  Textarea,
} from '../components/ui/index.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { CatalogWarningsContext } from '../forms/fields/model.js';
import { LOOP_FIELD_CONTROLS } from './field-controls.js';
import type { EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

const VariablesFormSchema = z.object({ variables: VariableDeclarationsSchema });

/**
 * Loop name, description, settings, and declared variables (name to JSON Schema). The forms keep
 * their own state: remount this (a `key`) when the definition is replaced, as a load does.
 */
export function LoopSettingsPanel({
  definition,
  issues = [],
}: {
  definition: LoopDefinitionInput;
  issues?: readonly EditorIssue[] | undefined;
}) {
  const { updateMeta, updateSettings, updateVariables, setFieldError } = useEditorStore.getState();
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  // The contract's own message for a name it refuses (a blank one, say).
  const nameError = LoopDefinitionSchema.shape.name.safeParse(definition.name).error?.issues[0]
    ?.message;
  return (
    <section aria-label="Loop settings" className="grid gap-field">
      <RequiredNote />
      <FieldGroup>
        <Label htmlFor="loop-name" required>
          Name
        </Label>
        <Input
          id="loop-name"
          aria-required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'loop-name-error' : undefined}
          value={definition.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
        />
        {nameError ? (
          <HelpText id="loop-name-error" role="alert" tone="bad">
            {nameError}
          </HelpText>
        ) : null}
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
      <CatalogWarningsContext
        value={issues
          .filter((issue) => !issue.nodeId && issue.path?.startsWith('settings.'))
          .map((issue) => ({ ...issue, path: issue.path?.slice('settings.'.length) }))}
      >
        <SchemaForm
          schema={LoopSettingsSchema}
          controls={LOOP_FIELD_CONTROLS}
          value={definition.settings ?? {}}
          label="Loop settings form"
          onChange={updateSettings}
          parseErrors={fieldErrors['settings']}
          onParseError={(path, error, reason, change) =>
            setFieldError('settings', path, error, reason, change)
          }
        />
      </CatalogWarningsContext>
      <div className="mt-2 grid gap-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Variables</h3>
        <HelpText>Each variable maps a name to a JSON Schema.</HelpText>
      </div>
      <SchemaForm
        schema={VariablesFormSchema}
        value={{ variables: definition.variables ?? {} }}
        label="Variables form"
        onChange={(value, change) =>
          updateVariables((value as { variables?: unknown }).variables ?? {}, change)
        }
        parseErrors={fieldErrors['variables']}
        onParseError={(path, error, reason, change) =>
          setFieldError('variables', path, error, reason, change)
        }
      />
    </section>
  );
}
