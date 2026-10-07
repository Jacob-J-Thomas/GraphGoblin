import { HarnessOptionsSchema, type ClaudePolicy } from '@graphgoblin/contracts';
import { useId } from 'react';
import { useWatch } from 'react-hook-form';
import { usePreflight } from '../api/queries.js';
import { FieldGroup, HelpText, Label, Select } from '../components/ui/index.js';
import { useFormChange } from '../forms/changes.js';
import { DefaultField } from '../forms/fields.js';
import { EnumField } from '../forms/fields/choice.js';
import { FieldError, useField, useFieldControl, type FieldProps } from '../forms/fields/shared.js';
import { shapeOf } from '../forms/introspect.js';

function selectedHarness(value: unknown): string {
  return typeof value === 'string' ? value : 'codex';
}

function ApprovalEnum({ schema, name, label }: FieldProps) {
  const shape = shapeOf(schema);
  return shape.kind === 'enum' ? (
    <EnumField schema={schema} name={name} label={label} options={shape.options} />
  ) : (
    <DefaultField schema={schema} name={name} label={label} />
  );
}

/** An explicit pair selector for Claude; Codex keeps the ordinary schema-driven controls. */
export function ClaudePolicyField(props: FieldProps) {
  const harness = selectedHarness(useWatch({ name: 'harness' }));
  return harness === 'claude' ? (
    <ClaudePolicySelect {...props} label="Sandbox and approval policy" />
  ) : (
    <ApprovalEnum {...props} />
  );
}

function ClaudePolicySelect({ name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const change = useFormChange();
  const approvalName = `${name.slice(0, name.lastIndexOf('.') + 1)}approval`;
  const approvalField = useField(approvalName, 'commit');
  const approvalValue = approvalField.value;
  const sandbox = typeof field.value === 'string' ? field.value : 'workspace-write';
  const approval =
    typeof approvalValue === 'string'
      ? approvalValue
      : HarnessOptionsSchema.shape.approval.parse(undefined);
  const preflight = usePreflight();
  const policyItem = preflight.data?.find((item) => item.harness === 'claude');
  const policies =
    policyItem?.ok === true && policyItem.authenticated ? (policyItem.supportedPolicies ?? []) : [];
  const currentIndex = policies.findIndex(
    (policy) => policy.sandbox === sandbox && policy.approval === approval,
  );
  const selected = currentIndex < 0 ? 'unsupported' : String(currentIndex);
  const id = useId();
  const policyHelpId = `${id}-policy-help`;
  const { control, errorId } = useFieldControl(name, id, { help: false, required: false });
  const unavailable = policies.length === 0;
  return (
    <FieldGroup data-field={name}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        {...control}
        id={id}
        aria-describedby={[control['aria-describedby'], policyHelpId].filter(Boolean).join(' ')}
        value={selected}
        aria-readonly={unavailable || undefined}
        onBlur={field.onBlur}
        onChange={(event) => {
          if (unavailable) {
            event.currentTarget.value = selected;
            return;
          }
          const next = policies[Number(event.target.value)];
          if (!next) return;
          change({ path: name, kind: 'commit' }, () => {
            field.onChange(next.sandbox);
            approvalField.onChange(next.approval);
          });
        }}
      >
        {selected === 'unsupported' ? (
          <option value="unsupported" disabled>
            Current policy: {sandbox} / {approval}{' '}
            {unavailable ? '(saved; not verified)' : '(unsupported; saved)'}
          </option>
        ) : null}
        {policies.map((policy: ClaudePolicy, index) => (
          <option key={`${policy.sandbox}/${policy.approval}`} value={String(index)}>
            {policy.sandbox === 'read-only'
              ? 'Read-only — built-in tools only; no OS or read-path isolation'
              : 'Danger full access — command execution and network unconfined'}
          </option>
        ))}
      </Select>
      {policies.length > 0 && currentIndex < 0 ? (
        <HelpText role="alert" tone="bad">
          The saved sandbox and approval pair is unsupported. Choose one of the listed policies to
          correct it.
        </HelpText>
      ) : null}
      <HelpText id={policyHelpId}>
        Read-only restricts built-in tools but provides no filesystem or OS confinement. Danger full
        access leaves command execution and network unconfined.
      </HelpText>
      {unavailable ? (
        <HelpText role="status" tone="warn">
          {preflight.isError
            ? 'Claude policy options could not be verified. The saved policy is unchanged.'
            : preflight.data === undefined
              ? 'Loading Claude policy options. The saved policy is unchanged.'
              : !policyItem?.ok || !policyItem.authenticated
                ? 'Claude CLI preflight is not ready. The saved policy is unchanged.'
                : 'No supported Claude policy is available on this platform. The saved policy is unchanged.'}
        </HelpText>
      ) : null}
      <FieldError name={name} id={errorId} />
    </FieldGroup>
  );
}

/** Approval remains visible for invalid saved values, but Claude only permits `never`. */
export function ClaudeApprovalField(props: FieldProps) {
  const harness = selectedHarness(useWatch({ name: 'harness' }));
  return harness === 'claude' ? <ClaudeApprovalValue {...props} /> : <ApprovalEnum {...props} />;
}

function ClaudeApprovalValue(props: FieldProps) {
  const field = useField(props.name, 'commit');
  const value = typeof field.value === 'string' ? field.value : 'never';
  const id = useId();
  const { control, helpId, errorId } = useFieldControl(props.name, id, {
    help: true,
    required: false,
  });
  return (
    <FieldGroup data-field={props.name}>
      <Label htmlFor={id}>{props.label}</Label>
      <Select {...control} id={id} value={value} disabled aria-describedby={helpId}>
        {value !== 'never' ? <option value={value}>{value} (unsupported; saved)</option> : null}
        <option value="never">never</option>
      </Select>
      <HelpText id={helpId}>
        Claude supports never approval only; choose a supported policy above to correct this value.
      </HelpText>
      <FieldError name={props.name} id={errorId} />
    </FieldGroup>
  );
}
