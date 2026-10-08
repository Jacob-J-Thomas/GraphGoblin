import {
  ChoiceConfigSchema,
  EvaluationSchema,
  NoulSpecSchema,
  ScoreSpecSchema,
  type Evaluation,
  type PrimitiveAnswerSpec,
} from '@graphgoblin/contracts';
import { useId } from 'react';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  CHECKBOX_LABEL,
  FieldGroup,
  Fieldset,
  HelpText,
  Legend,
  Select,
} from '../components/ui/index.js';
import { Field, useField, type FieldControl, type FieldProps } from '../forms/fields.js';
import { FieldError, Row } from '../forms/fields/shared.js';
import { discriminatorValue, shapeOf, type Schema } from '../forms/introspect.js';
import { isUnset } from '../forms/unset.js';

type Primitive = PrimitiveAnswerSpec['type'];
type EvaluationKind = Evaluation['kind'];

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sibling(name: string, key: string): string {
  return `${name.slice(0, name.lastIndexOf('.') + 1)}${key}`;
}

function primitive(value: unknown): Primitive | undefined {
  const type = record(value)['type'];
  return type === 'choice' || type === 'noul' || type === 'score' ? type : undefined;
}

const DEFAULT_ANSWERS: Record<Primitive, Record<string, unknown>> = {
  choice: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'The predicate matches' },
      { id: 'no', label: 'No', criteria: 'The predicate does not match' },
    ],
  },
  noul: {
    type: 'noul',
    true: { label: 'True', criteria: 'The predicate is true' },
    false: { label: 'False', criteria: 'The predicate is false' },
  },
  score: {
    type: 'score',
    anchors: ['Does not meet the rubric', 'Partly meets the rubric', 'Fully meets the rubric'],
  },
};

const ChoiceOptionSchema = ChoiceConfigSchema.shape.options.element;
const EXIT_CHOICE_OPTIONS_SCHEMA = z
  .array(
    ChoiceOptionSchema.extend({
      id: ChoiceOptionSchema.shape.id.describe(
        'Stable Choice option ID used by this exit match. Exit nodes can only follow their loopBack connection.',
      ),
    }),
  )
  .min(2)
  .max(64);

function evaluationSchema(kind: EvaluationKind): Record<string, Schema> | undefined {
  const shape = shapeOf(EvaluationSchema);
  if (shape.kind !== 'union' || !shape.discriminator) return undefined;
  const option = shape.options.find(
    (candidate) => discriminatorValue(candidate, shape.discriminator!) === kind,
  );
  const optionShape = option && shapeOf(option);
  return optionShape?.kind === 'object' ? optionShape.shape : undefined;
}

function matchSchema(schema: Schema, kind: Primitive): Record<string, Schema> | undefined {
  const shape = shapeOf(schema);
  if (shape.kind !== 'union' || !shape.discriminator) return undefined;
  const option = shape.options.find(
    (candidate) => discriminatorValue(candidate, shape.discriminator!) === kind,
  );
  const optionShape = option && shapeOf(option);
  return optionShape?.kind === 'object' ? optionShape.shape : undefined;
}

function EvaluationFields({
  name,
  answerType,
  kind,
}: {
  name: string;
  answerType: Primitive;
  kind: EvaluationKind;
}) {
  const fields = evaluationSchema(kind);
  const evaluation = record(useWatch({ name }));
  if (!fields) return null;
  const path = (key: string) => `${name}.${key}`;
  if (kind === 'expression') {
    const jsonata = fields['jsonata'];
    return jsonata ? (
      <Field schema={jsonata} name={path('jsonata')} label="JSONata expression" />
    ) : null;
  }
  if (kind === 'classifier') {
    const hasThreshold =
      Object.hasOwn(evaluation, 'truthThreshold') && !isUnset(evaluation['truthThreshold']);
    return (
      <>
        {fields['model'] ? (
          <Field schema={fields['model']} name={path('model')} label="Classifier" />
        ) : null}
        {fields['question'] ? (
          <Field schema={fields['question']} name={path('question')} label="Question" />
        ) : null}
        {fields['minConfidence'] ? (
          <Field
            schema={fields['minConfidence']}
            name={path('minConfidence')}
            label="Minimum classifier confidence"
          />
        ) : null}
        {fields['truthThreshold'] && (answerType === 'noul' || hasThreshold) ? (
          <>
            <Field
              schema={fields['truthThreshold']}
              name={path('truthThreshold')}
              label="Noul true-probability threshold"
            />
            {answerType === 'noul' ? (
              <HelpText>
                At this threshold or above, the classifier selects true. This is separate from
                minimum classifier confidence, which can reject the whole answer.
              </HelpText>
            ) : (
              <HelpText>
                Remove this inapplicable value to fix the predicate. The true-probability threshold
                applies only to Noul answers.
              </HelpText>
            )}
          </>
        ) : null}
      </>
    );
  }
  return (
    <>
      {fields['harness'] ? (
        <Field schema={fields['harness']} name={path('harness')} label="Harness" />
      ) : null}
      {fields['model'] ? (
        <Field schema={fields['model']} name={path('model')} label="Model" />
      ) : null}
      {fields['effort'] ? (
        <Field schema={fields['effort']} name={path('effort')} label="Reasoning effort" />
      ) : null}
      {fields['question'] ? (
        <Field schema={fields['question']} name={path('question')} label="Question" />
      ) : null}
    </>
  );
}

function ExitPredicateAnswerField({ name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const evaluationKind = useWatch({ name: sibling(name, 'evaluation.kind') }) as unknown;
  const current = primitive(field.value);
  const selected = current ?? 'choice';
  const provider = evaluationKind === 'classifier' || evaluationKind === 'llm';
  const side = (key: 'true' | 'false') => (
    <Field
      schema={NoulSpecSchema.shape[key]}
      name={`${name}.${key}`}
      label={key === 'true' ? 'True side' : 'False side'}
    />
  );

  return (
    <Fieldset data-field={name}>
      <Legend>{label}</Legend>
      <ChoiceGroup
        legend="Answer type"
        name={`${name}-type`}
        layout="grid"
        choices={[
          {
            key: 'choice',
            value: 'choice',
            checked: selected === 'choice',
            onSelect: () => field.onChange(DEFAULT_ANSWERS.choice),
            label: 'Choice',
            description: 'Compare a declared option ID with the match rule.',
          },
          {
            key: 'noul',
            value: 'noul',
            checked: selected === 'noul',
            onSelect: () => field.onChange(provider ? DEFAULT_ANSWERS.noul : { type: 'noul' }),
            label: 'Noul',
            description: 'Return a strict true or false answer, then choose which value matches.',
          },
          {
            key: 'score',
            value: 'score',
            checked: selected === 'score',
            onSelect: () => field.onChange(DEFAULT_ANSWERS.score),
            label: 'Score',
            description:
              'Classifier only. Keep fractional rubric indexes exact; Match compares without rounding.',
          },
        ]}
      />
      {selected === 'choice' ? (
        <Field
          schema={EXIT_CHOICE_OPTIONS_SCHEMA}
          name={`${name}.options`}
          label="Choice options"
        />
      ) : selected === 'noul' ? (
        provider ? (
          <>
            {side('true')}
            {side('false')}
          </>
        ) : (
          <HelpText>
            Expression Noul returns only a boolean; it does not need provider criteria.
          </HelpText>
        )
      ) : (
        <Field
          schema={ScoreSpecSchema.shape.anchors}
          name={`${name}.anchors`}
          label="Ordered rubric anchors"
        />
      )}
      <FieldError name={name} />
    </Fieldset>
  );
}

function ExitPredicateEvaluationField({ name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const answerType = useWatch({ name: sibling(name, 'answer.type') }) as unknown;
  const selected = record(field.value)['kind'];
  const evaluation = record(field.value);
  const kind: EvaluationKind =
    selected === 'classifier' || selected === 'llm' ? selected : 'expression';
  const primitiveType = answerType === 'noul' || answerType === 'score' ? answerType : 'choice';
  const hasThreshold =
    Object.hasOwn(evaluation, 'truthThreshold') && !isUnset(evaluation['truthThreshold']);
  const choose = (next: EvaluationKind) => {
    if (next === kind) return;
    const preservedQuestion =
      (kind === 'classifier' || kind === 'llm') && typeof evaluation['question'] === 'string'
        ? evaluation['question']
        : undefined;
    if (next === 'expression') {
      field.onChange({ kind: next, jsonata: primitiveType === 'noul' ? 'true' : '"yes"' });
    } else if (next === 'classifier') {
      field.onChange({
        kind: next,
        model: '',
        question: preservedQuestion ?? 'Evaluate the current input against the declared answer.',
      });
    } else {
      field.onChange({
        kind: next,
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        question: preservedQuestion ?? '',
      });
    }
  };
  const choices = [
    ...(primitiveType === 'noul'
      ? [
          {
            key: 'expression',
            value: 'expression',
            checked: kind === 'expression',
            onSelect: () => choose('expression'),
            label: 'Expression',
            description:
              'Run JSONata locally. The result must match the selected answer type exactly.',
          },
        ]
      : []),
    {
      key: 'classifier',
      value: 'classifier',
      checked: kind === 'classifier',
      onSelect: () => choose('classifier'),
      label: 'Classifier',
      description:
        primitiveType === 'score'
          ? 'Use an enabled Score-capable classifier; its fractional rubric index is kept exact.'
          : `Use one enabled ${primitiveType === 'noul' ? 'Noul' : 'Choice'}-capable classifier.`,
    },
    ...(primitiveType === 'score'
      ? []
      : [
          {
            key: 'llm',
            value: 'llm',
            checked: kind === 'llm',
            onSelect: () => choose('llm'),
            label: 'Codex LLM',
            description: 'Use one Codex model to return a structured Choice or Noul answer.',
          },
        ]),
  ];
  const evaluatorFields = evaluationSchema(kind);

  return (
    <Fieldset data-field={name}>
      <Legend>{label}</Legend>
      <ChoiceGroup
        legend="Evaluation method"
        name={`${name}-kind`}
        layout="grid"
        choices={choices}
      />
      <EvaluationFields name={name} answerType={primitiveType} kind={kind} />
      {selected === 'llm' && primitiveType === 'score' ? (
        <HelpText>
          This saved evaluator cannot score. Select Classifier to evaluate a Score answer.
        </HelpText>
      ) : null}
      {selected === 'expression' && primitiveType !== 'noul' ? (
        <HelpText>
          Expression evaluation is available only for Noul answers. Choose a classifier or Codex LLM
          to evaluate this answer.
        </HelpText>
      ) : null}
      {selected === 'classifier' &&
      evaluatorFields?.['truthThreshold'] &&
      answerType !== 'noul' &&
      !hasThreshold ? (
        <HelpText>The Noul true-probability threshold is available only for Noul answers.</HelpText>
      ) : null}
      <FieldError name={name} />
    </Fieldset>
  );
}

function ExitPredicateMatchField({ schema, name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const answerType = primitive(useWatch({ name: sibling(name, 'answer') }));
  const answer = record(useWatch({ name: sibling(name, 'answer') }));
  const evaluationKind: unknown = useWatch({ name: sibling(name, 'evaluation.kind') });
  const noulMatchValue: unknown = useWatch({ name: `${name}.value` });
  const kind = answerType ?? 'noul';
  const variant = matchSchema(schema, kind);
  const valueSchema = variant?.['value'];
  const operatorSchema = variant?.['operator'];
  const matchValue = record(field.value);
  const minConfidence = variant?.['minReportedConfidence'];
  const currentMatch = record(field.value);
  const typeMatches = currentMatch['type'] === kind;
  const hasReportedMinimum = Object.hasOwn(currentMatch, 'minReportedConfidence');
  const optionIds =
    typeMatches && Array.isArray(currentMatch['optionIds'])
      ? currentMatch['optionIds'].filter((id): id is string => typeof id === 'string')
      : [];
  const options = Array.isArray(answer['options']) ? answer['options'].map(record) : [];
  const declaredOptionIds = new Set(
    options.flatMap((option) =>
      typeof option['id'] === 'string' && option['id'] !== '' ? [option['id']] : [],
    ),
  );
  const unavailableOptionIds = optionIds.filter((optionId) => !declaredOptionIds.has(optionId));
  const id = useId();
  const addOption = (optionId: string, checked: boolean) => {
    const selected = checked
      ? [...new Set([...optionIds, optionId])]
      : optionIds.filter((item) => item !== optionId);
    field.onChange({
      type: 'choice',
      optionIds: selected,
      ...(hasReportedMinimum
        ? { minReportedConfidence: currentMatch['minReportedConfidence'] }
        : {}),
    });
  };
  const removeUnavailableOption = (optionId: string) => {
    field.onChange({
      type: 'choice',
      optionIds: optionIds.filter((item) => item !== optionId),
      ...(hasReportedMinimum
        ? { minReportedConfidence: currentMatch['minReportedConfidence'] }
        : {}),
    });
  };

  return (
    <Fieldset data-field={name}>
      <Legend>{label}</Legend>
      <HelpText>
        Evaluation produces an answer; this rule decides whether that answer exits the loop. A
        confidence gate rejection is always a nonmatch.
      </HelpText>
      {kind === 'noul' ? (
        <>
          {valueSchema ? (
            <Field
              schema={valueSchema.describe(
                `Matching answer: ${noulMatchValue === false ? 'False' : 'True'}.`,
              )}
              name={`${name}.value`}
              label="Match when the answer is true"
            />
          ) : null}
          {(evaluationKind === 'llm' || hasReportedMinimum) && minConfidence ? (
            <>
              <Field
                schema={minConfidence}
                name={`${name}.minReportedConfidence`}
                label="Minimum self-reported confidence"
              />
              {evaluationKind === 'llm' ? (
                <HelpText>
                  This is the value reported by Codex, not a calibrated classifier confidence.
                </HelpText>
              ) : (
                <HelpText>
                  This saved value applies only to Codex LLM predicates. Remove it to fix this match
                  rule.
                </HelpText>
              )}
            </>
          ) : null}
        </>
      ) : kind === 'choice' ? (
        <>
          <FieldGroup>
            <Legend variant="label">Matching Choice options</Legend>
            {options.length === 0 ? (
              <HelpText>Declare Choice option IDs before selecting matches.</HelpText>
            ) : null}
            {unavailableOptionIds.map((optionId) => (
              <div
                key={optionId}
                className="flex items-center justify-between gap-2 rounded-md border border-status-warn-border bg-status-warn-bg px-3 py-2 text-sm"
              >
                <span>
                  Unavailable Choice option ID <code>{optionId}</code>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Remove unavailable match ${optionId}`}
                  onClick={() => removeUnavailableOption(optionId)}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="grid gap-1">
              {options.map((option, index) => {
                const optionId = option['id'];
                if (typeof optionId !== 'string' || optionId === '') return null;
                const inputId = `${id}-${index}`;
                return (
                  <label key={`${optionId}-${index}`} htmlFor={inputId} className={CHECKBOX_LABEL}>
                    <Checkbox
                      id={inputId}
                      checked={optionIds.includes(optionId)}
                      onChange={(event) => addOption(optionId, event.currentTarget.checked)}
                    />
                    <span>{typeof option['label'] === 'string' ? option['label'] : optionId}</span>
                    <code className="text-xs text-muted">{optionId}</code>
                  </label>
                );
              })}
            </div>
          </FieldGroup>
          <FieldError name={`${name}.optionIds`} />
          {(evaluationKind === 'llm' || hasReportedMinimum) && minConfidence ? (
            <>
              <Field
                schema={minConfidence}
                name={`${name}.minReportedConfidence`}
                label="Minimum self-reported confidence"
              />
              {evaluationKind === 'llm' ? (
                <HelpText>
                  This is the value reported by Codex, not a calibrated classifier confidence.
                </HelpText>
              ) : (
                <HelpText>
                  This saved value applies only to Codex LLM predicates. Remove it to fix this match
                  rule.
                </HelpText>
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          {operatorSchema ? (
            <Row name={`${name}.operator`} label="Score comparison">
              {(control) => (
                <Select
                  {...control}
                  value={
                    typeMatches && typeof matchValue['operator'] === 'string'
                      ? matchValue['operator']
                      : 'gte'
                  }
                  onChange={(event) =>
                    field.onChange({
                      type: 'score',
                      operator: event.target.value,
                      value:
                        typeMatches && typeof matchValue['value'] === 'number'
                          ? matchValue['value']
                          : 0,
                    })
                  }
                >
                  <option value="lt">less than (&lt;)</option>
                  <option value="lte">less than or equal (≤)</option>
                  <option value="eq">equal to (=)</option>
                  <option value="gte">greater than or equal (≥)</option>
                  <option value="gt">greater than (&gt;)</option>
                </Select>
              )}
            </Row>
          ) : null}
          {valueSchema ? (
            <Field schema={valueSchema} name={`${name}.value`} label="Rubric index" />
          ) : null}
          <HelpText>
            Scores are fractional rubric indexes. Equality compares the exact number, including
            values such as 1.25; no rounding is applied.
          </HelpText>
        </>
      )}
    </Fieldset>
  );
}

export const EXIT_PREDICATE_FIELD_OVERRIDES: Readonly<Record<string, FieldControl>> = {
  'criteria.*.answer': ExitPredicateAnswerField,
  'criteria.*.evaluation': ExitPredicateEvaluationField,
  'criteria.*.match': ExitPredicateMatchField,
};
