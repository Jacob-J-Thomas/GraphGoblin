import { ExpressionSchema, field as fieldMetaOf } from '@graphgoblin/contracts';
import { useMemo, useRef } from 'react';
import { useWatch } from 'react-hook-form';
import { FieldGroup, HelpText, SegmentedControl } from '../components/ui/index.js';
import { DefaultField, useField, type FieldProps } from '../forms/fields.js';
import { StringControl } from '../forms/fields/text.js';
import { useFormChange } from '../forms/changes.js';

/** The return expression's own help: where its value goes, and which path to read work from. */
const RETURN_EXPRESSION_SCHEMA = ExpressionSchema.meta(
  fieldMetaOf(
    'Its value becomes the run result and goes to every destination. Gate decisions replace lastOutput; prefer outputs.<workNode>.value.',
  ),
);

/** The editor's reading of Returns: anything but an authored expression returns nothing. */
function returnsExpression(value: unknown): boolean {
  return typeof value === 'string' && value !== 'none';
}

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
  const expression = returnsExpression(field.value);
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
          schema={RETURN_EXPRESSION_SCHEMA}
          shape={{ kind: 'string', format: 'expression' }}
          name={name}
          label="Return expression"
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      ) : (
        <HelpText>
          No returned value. The run finishes without a result, and destinations receive nothing.
        </HelpText>
      )}
    </FieldGroup>
  );
}

/**
 * Destinations, with help that says what they receive. While Returns is None, configured
 * destinations receive nothing (the engine skips delivery), and an exit without destinations is a
 * deliberate quiet exit; both are valid, so this is help, not a validation issue (#129, #258).
 */
export function ExitDestinationsField(props: FieldProps) {
  const returns: unknown = useWatch({ name: 'returns' });
  const destinations: unknown = useWatch({ name: props.name });
  // An exit that never set destinations has the contract's default: one caller destination.
  const count = Array.isArray(destinations) ? destinations.length : 1;
  const help = returnsExpression(returns)
    ? undefined
    : count === 0
      ? 'Quiet exit: nothing is returned or delivered. The run still finishes with its outcome.'
      : `Returns is None, so ${count === 1 ? 'this destination receives' : `these ${count} destinations receive`} nothing. Choose a JSONata expression to deliver a value, or remove destinations for a quiet exit.`;
  const schema = useMemo(
    () => (help === undefined ? props.schema : props.schema.describe(help)),
    [help, props.schema],
  );
  return <DefaultField {...props} schema={schema} />;
}

export const EXIT_FIELD_OVERRIDES = {
  outcome: ExitOutcomeField,
  returns: ExitReturnsField,
  destinations: ExitDestinationsField,
};
