import { ChoiceGroup } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';

const ANSWER_COPY: Readonly<Record<string, { title: string; description: string }>> = {
  choice: {
    title: 'Choice',
    description: 'Return one declared option. Each option ID is a stable output port.',
  },
  noul: {
    title: 'Noul',
    description: 'Return a strict true or false answer. Each side has its own stable output port.',
  },
  score: {
    title: 'Score',
    description:
      'Classifier only. Scores can fall between anchors, such as 1.25. Each band includes its starting value and stops just before its ending value; the last band also includes the rubric endpoint. Scores are never rounded.',
  },
};

/** A compact, keyboard-native picker for the decision's answer primitive. */
export function DecisionAnswerPicker({
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
      legend={label + ' type'}
      name={name}
      layout="grid"
      required={required}
      describedBy={describedBy}
      invalid={invalid}
      className="decision-kind-picker"
      choices={options.map((option) => {
        const copy = ANSWER_COPY[option.value] ?? {
          title: option.label,
          description: 'Choose this answer type.',
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
