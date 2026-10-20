import { HarnessIdSchema, InferenceConfigSchema } from '@graphgoblin/contracts';
import { use, useEffect, useId, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Icon } from '../components/icons/index.js';
import { FieldGroup, HelpText, SegmentedControl } from '../components/ui/index.js';
import { NodeOutputsContext } from '../forms/EarlierNodeOutputs.js';
import { useFormChange } from '../forms/changes.js';
import { useHarnessSwitch } from '../forms/fields/model.js';
import {
  FieldError,
  FieldHelp,
  fieldMeta,
  useField,
  useFieldControl,
  type FieldProps,
} from '../forms/fields/shared.js';
import { isUnset, UNSET } from '../forms/unset.js';

/** Inference-only authoring action: the harness and dependent values form one undo step. */
function HarnessField({ schema, name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const { getValues, reset } = useFormContext();
  const change = useFormChange();
  const switchHarness = useHarnessSwitch();
  const outputs = use(NodeOutputsContext);
  const [notice, setNotice] = useState<{ text: string; values: string; loading: boolean }>();
  const values = JSON.stringify(useWatch({ name: ['model', 'effort'] }));
  const requestRef = useRef(0);
  useEffect(
    () => () => {
      requestRef.current++;
    },
    [],
  );
  const id = useId();
  const { required, help } = fieldMeta(schema);
  const { control, helpId, errorId } = useFieldControl(name, id, {
    help: help !== undefined,
    required,
  });
  const visible = notice?.values === values ? notice : undefined;
  const noticeId = `${id}-switch`;
  return (
    <FieldGroup data-field={name}>
      <SegmentedControl
        legend={label}
        required={required}
        options={HarnessIdSchema.options.map((value) => ({ value, label: value }))}
        value={InferenceConfigSchema.shape.harness.safeParse(field.value).data}
        describedBy={[control['aria-describedby'], visible ? noticeId : undefined]
          .filter(Boolean)
          .join(' ')}
        onChange={(harness) => {
          const attempt = ++requestRef.current;
          const before: Record<string, unknown> = getValues();
          const snapshot = JSON.stringify(before);
          const read = (key: string): unknown => (isUnset(before[key]) ? undefined : before[key]);
          const select = switchHarness(
            harness,
            read('model'),
            read('effort'),
            outputs?.definition.settings?.defaults,
            () =>
              setNotice({
                text: 'Waiting for the first model catalog, Settings and readiness checks to finish... The harness change will apply when they finish.',
                values,
                loading: true,
              }),
          );
          void select.then((selection) => {
            // Undo, another switch, dismissal or a concurrent field edit cancels this action.
            if (attempt !== requestRef.current || JSON.stringify(getValues()) !== snapshot) return;
            setNotice(
              selection.message ? { text: selection.message, values, loading: false } : undefined,
            );
            change({ path: name, kind: 'commit' }, () => {
              reset(
                {
                  ...before,
                  ...('model' in selection ? { model: selection.model } : {}),
                  ...('effort' in selection ? { effort: selection.effort ?? UNSET } : {}),
                  harness,
                  ...(harness === 'claude'
                    ? {
                        harnessOptions: {
                          ...(typeof before['harnessOptions'] === 'object' &&
                          before['harnessOptions'] !== null
                            ? before['harnessOptions']
                            : {}),
                          sandbox: 'read-only',
                          approval: 'never',
                        },
                      }
                    : {}),
                },
                { keepDefaultValues: true },
              );
            });
          });
        }}
      />
      {visible ? (
        <HelpText id={noticeId} role="status" tone={visible.loading ? 'muted' : 'warn'}>
          {!visible.loading ? (
            <Icon name="alert" className="mr-1 inline size-3.5 align-text-bottom" />
          ) : null}
          {visible.text}
        </HelpText>
      ) : null}
      <FieldHelp id={helpId} help={help} />
      <FieldError name={name} id={errorId} />
    </FieldGroup>
  );
}

export const INFERENCE_FIELD_OVERRIDES = { harness: HarnessField };
