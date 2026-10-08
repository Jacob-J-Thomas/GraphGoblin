import { useWatch } from 'react-hook-form';
import { DefaultField, type FieldOverrides, type FieldProps } from '../forms/fields.js';
import { isUnset } from '../forms/unset.js';

/** Hide the optional Noul-only setting when it is inapplicable and has no value to fix. */
export function DecisionTruthThresholdField(props: FieldProps) {
  const answerType = useWatch({ name: 'answer.type' }) as unknown;
  const threshold: unknown = useWatch({ name: props.name });
  if (answerType !== 'noul' && (threshold === undefined || isUnset(threshold))) return null;
  return <DefaultField {...props} />;
}

export const DECISION_FIELD_OVERRIDES = {
  'evaluation.truthThreshold': DecisionTruthThresholdField,
} satisfies FieldOverrides;
