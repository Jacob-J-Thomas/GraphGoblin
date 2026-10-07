import { ChoiceGroup } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';

const KIND_COPY: Readonly<Record<string, { title: string; description: string }>> = {
  expression: {
    title: 'Expression',
    description: 'Evaluate JSONata and route to the returned option ID.',
  },
  classifier: {
    title: 'Classifier',
    description: 'Use a configured Choice-capable classifier with a question and context.',
  },
  llm: {
    title: 'LLM',
    description: 'Ask a selected Codex model to choose from the option criteria.',
  },
};

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
  return (
    <ChoiceGroup
      legend={label + ' method'}
      name={name}
      layout="grid"
      required={required}
      describedBy={describedBy}
      invalid={invalid}
      className="decision-kind-picker"
      choices={options.map((option) => {
        const copy = KIND_COPY[option.value] ?? {
          title: option.label,
          description: 'Choose this evaluation method.',
        };
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
