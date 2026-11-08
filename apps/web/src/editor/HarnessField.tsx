import { HarnessIdSchema, InferenceConfigSchema } from '@graphgoblin/contracts';
import { use, useEffect, useId, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Icon } from '../components/icons/index.js';
import { Button, FieldGroup, HelpText, SegmentedControl } from '../components/ui/index.js';
import { OLLAMA_FIELD_OVERRIDES } from './OllamaPolicyFields.js';
import { ollamaPolicyProblems, withOllamaLimits } from './ollama-policy.js';
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
  const [policyNotice, setPolicyNotice] = useState('');
  useWatch({
    name: ['session', 'harnessOptions', 'capabilities', 'contextFiles', 'output.schema'],
  });
  const policyProblems = field.value === 'ollama' ? ollamaPolicyProblems(getValues()) : [];
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
    <FieldGroup id={`${id}-harness`} data-field={name}>
      <SegmentedControl
        legend={label}
        required={required}
        options={HarnessIdSchema.options.map((value) => ({
          value,
          label: value === 'ollama' ? 'Ollama' : value,
        }))}
        value={InferenceConfigSchema.shape.harness.safeParse(field.value).data}
        describedBy={[control['aria-describedby'], visible ? noticeId : undefined]
          .filter(Boolean)
          .join(' ')}
        onChange={(harness) => {
          const attempt = ++requestRef.current;
          const before: Record<string, unknown> = getValues();
          const snapshot = JSON.stringify(before);
          const read = (key: string): unknown => (isUnset(before[key]) ? undefined : before[key]);
          const select =
            harness === 'ollama'
              ? Promise.resolve({ message: undefined })
              : switchHarness(
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
            if (attempt !== requestRef.current) return;
            if (JSON.stringify(getValues()) !== snapshot) {
              setNotice(undefined);
              return;
            }
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
      {policyProblems.length ? (
        <div className="grid justify-items-start gap-2">
          <HelpText tone="warn">
            {policyProblems.length} settings here don’t work with Ollama.
          </HelpText>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const count = policyProblems.length;
              change({ path: name, kind: 'commit' }, () =>
                reset(withOllamaLimits(getValues()), { keepDefaultValues: true }),
              );
              setPolicyNotice(`Changed ${count} settings for Ollama. Undo restores them.`);
              document
                .getElementById(`${id}-harness`)
                ?.querySelector<HTMLInputElement>('input[value="ollama"]')
                ?.focus();
            }}
          >
            Use Ollama limits
          </Button>
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {field.value === 'ollama' ? policyNotice : ''}
      </span>
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

export const INFERENCE_FIELD_OVERRIDES = { ...OLLAMA_FIELD_OVERRIDES, harness: HarnessField };
