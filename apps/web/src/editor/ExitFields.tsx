import { ExpressionSchema } from '@graphgoblin/contracts';
import { useRef } from 'react';
import { FieldGroup, HelpText, SegmentedControl } from '../components/ui/index.js';
import { useField, type FieldProps } from '../forms/fields.js';
import { StringControl } from '../forms/fields/text.js';
import { useFormChange } from '../forms/changes.js';

export function ExitOutcomeField({ name }: FieldProps) {
  const field = useField(name, 'commit');
  return (
    <FieldGroup data-field={name}>
      <SegmentedControl
        legend="Outcome"
        options={[
          { value: 'success', label: 'Success' },
          { value: 'failure', label: 'Failure' },
          { value: 'exhausted', label: 'Exhausted' },
        ]}
        value={typeof field.value === 'string' ? field.value : 'success'}
        onChange={field.onChange}
      />
    </FieldGroup>
  );
}

export function ExitReturnsField({ name }: FieldProps) {
  const field = useField(name, 'typing');
  const previousRef = useRef('');
  const change = useFormChange();
  const expression = typeof field.value === 'string' && field.value !== 'none';
  return (
    <FieldGroup data-field={name}>
      <SegmentedControl
        legend="Returns"
        options={[
          { value: 'none', label: 'None' },
          { value: 'expression', label: 'JSONata expression' },
        ]}
        value={expression ? 'expression' : 'none'}
        onChange={(next) =>
          change({ path: name, kind: 'commit' }, () => {
            if (expression) previousRef.current = String(field.value);
            field.onChange(next === 'none' ? 'none' : previousRef.current);
          })
        }
      />
      {expression ? (
        <StringControl
          schema={ExpressionSchema}
          shape={{ kind: 'string', format: 'expression' }}
          name={name}
          label="Return expression"
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      ) : (
        <HelpText>No returned value.</HelpText>
      )}
    </FieldGroup>
  );
}

export const EXIT_FIELD_OVERRIDES = { outcome: ExitOutcomeField, returns: ExitReturnsField };
