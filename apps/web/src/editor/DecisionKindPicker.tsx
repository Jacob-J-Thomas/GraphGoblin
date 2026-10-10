import { useWatch } from 'react-hook-form';
import { ChoiceGroup } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';

function kindCopy(kind: string, answerType: unknown) {
  if (kind === 'expression')
    return {
      title: 'Expression',
      description:
        answerType === 'noul'
          ? 'Evaluate JSONata locally; it must return a boolean true or false.'
          : 'Evaluate JSONata locally and route to the returned Choice option ID.',
    };
  if (kind === 'classifier')
    return {
      title: 'Classifier',
      description:
        answerType === 'noul'
          ? 'Use a Noul-capable classifier. The true-probability threshold chooses true; minimum confidence independently rejects uncertain answers.'
          : answerType === 'score'
            ? 'Use a Score-capable classifier to return a fractional rubric index for the declared bands.'
            : 'Use a configured Choice-capable classifier with a question and context.',
    };
  if (kind === 'llm')
    return {
      title: 'LLM',
      description:
        answerType === 'noul'
          ? 'Ask a selected Codex model for a structured true or false answer from the side criteria.'
          : 'Ask a selected Codex model to choose from the option criteria.',
    };
  return { title: kind, description: 'Choose this evaluation method.' };
}

/** A compact, keyboard-native card picker for a decision's evaluation method. */
export function DecisionKindPicker({
  name,
  label,
  options,
  value,
  onChange,
  required,
  describedBy,
  invalid,
}: UnionPickerProps) {
  const answerType = useWatch({ name: 'answer.type' }) as unknown;
  const availableOptions =
    answerType === 'score' ? options.filter((option) => option.value === 'classifier') : options;
  return (
    <ChoiceGroup
      legend={label + ' method'}
      name={name}
      layout="grid"
      required={required}
      describedBy={describedBy}
      invalid={invalid}
      className="decision-kind-picker"
      choices={availableOptions.map((option) => {
        const copy = kindCopy(option.value, answerType);
        return {
          key: option.value,
          value: option.value,
          checked: value === option.value,
          onSelect: () => onChange(option.value),
          label: copy.title,
          description: copy.description,
        };
      })}
    />
  );
}
