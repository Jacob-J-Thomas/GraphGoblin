import { createContext, use } from 'react';
import { HelpText } from '../../components/ui/index.js';
import { shapeOf, type Schema } from '../introspect.js';
import { fieldMeta, useField, type FieldProps } from './shared.js';
import { StringControl } from './text.js';

/** Suggestions are assistance, never a second validation allowlist. */
export const VariableSuggestionsContext = createContext<readonly string[]>([]);

export function VariableField(props: FieldProps) {
  const variables = use(VariableSuggestionsContext);
  const pointer = fieldMeta(props.schema).control === 'variable-path';
  return (
    <SuggestedField
      {...props}
      suggestions={pointer ? variables.map((name) => `/vars/${name}`) : variables}
    />
  );
}

function SuggestedField({
  suggestions,
  ...props
}: FieldProps & { suggestions?: readonly string[] }) {
  const field = useField(props.name, 'typing');
  const shape = shapeOf(props.schema);
  if (shape.kind !== 'string') return null;
  return (
    <StringControl
      {...props}
      shape={shape}
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      suggestions={suggestions}
    />
  );
}

export function CapabilityField(props: FieldProps) {
  // Format 3 records authored capability slugs but has no resolver or resolved catalog yet.
  return <SuggestedField {...props} />;
}

/** Capability availability belongs to the section, rather than each authored row. */
export function CapabilitySectionNotice({ schema }: { schema: Schema }) {
  const shape = shapeOf(schema);
  const capability =
    shape.kind === 'object' &&
    Object.values(shape.shape).some((child) => {
      const list = shapeOf(child);
      return list.kind === 'array' && fieldMeta(list.element).control?.startsWith('capability-');
    });
  return capability ? (
    <HelpText>No resolved capability identifiers are available. Enter authored slugs.</HelpText>
  ) : null;
}
