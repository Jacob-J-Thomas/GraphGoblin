import { use, useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { HelpText, Label, Switch } from '../components/ui/index.js';
import { DefaultField, type FieldProps } from '../forms/fields.js';
import { useFormChange } from '../forms/changes.js';
import { FormEditReviewContext } from '../forms/edit-review.js';
import { UNSET } from '../forms/unset.js';
import { unwrap } from '../forms/introspect.js';
import { useParseErrors } from '../forms/parse-errors.js';
import { gateRows, hasRepeatRoute } from './decision-gates.js';

/** Selecting a repeat route clears the other markers in the same form commit. */
export function RepeatRouteField({ name }: FieldProps) {
  const { getValues, setValue } = useFormContext();
  const value: unknown = useWatch({ name });
  const change = useFormChange(),
    review = use(FormEditReviewContext),
    id = useId();
  const parseErrors = useParseErrors();
  return (
    <div data-field={name} className="grid gap-1">
      <Label htmlFor={id}>Repeat route</Label>
      <Switch
        id={id}
        aria-label="Repeat route"
        checked={value === true}
        onCheckedChange={(checked) => {
          const apply = () =>
            change({ path: name, kind: 'commit' }, () => {
              if (checked) setValue(name, true);
              for (const row of gateRows(getValues()))
                if (`${row.path}.repeat` !== name || !checked)
                  setValue(`${row.path}.repeat`, UNSET);
              if (!checked) {
                parseErrors.report('maxPasses', undefined);
                parseErrors.report('maxRunTimeSeconds', undefined);
                setValue('maxPasses', UNSET);
                setValue('maxRunTimeSeconds', UNSET);
              }
            });
          if (checked) apply();
          else review({ type: 'gate', path: name, value: false }, apply);
        }}
      />
      <HelpText>Only one route can repeat. Connect it back to earlier work in this gate.</HelpText>
    </div>
  );
}

export function GateLimitField(props: FieldProps) {
  const config: unknown = useWatch();
  if (!hasRepeatRoute(config)) return null;
  return (
    <DefaultField
      {...props}
      schema={
        props.name === 'maxPasses'
          ? unwrap(props.schema).base.describe(
              'Required. Passes start at 1; a non-repeat choice wins on the last pass.',
            )
          : props.schema
      }
    />
  );
}

export const GATE_FIELD_OVERRIDES = {
  'routes.*.repeat': RepeatRouteField,
  'answer.options.*.repeat': RepeatRouteField,
  'answer.true.repeat': RepeatRouteField,
  'answer.false.repeat': RepeatRouteField,
  'answer.bands.*.repeat': RepeatRouteField,
  maxPasses: GateLimitField,
  maxRunTimeSeconds: GateLimitField,
};
