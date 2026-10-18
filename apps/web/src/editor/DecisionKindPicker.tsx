import { ChoiceGroup } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';
const COPY: Record<string, string> = {
  expression: 'Return one declared route ID from a JSONata expression.',
  llm: 'Give Codex Liquid instructions and readable routes. Confidence is informational.',
  classifier: 'Ask a configured classifier for Choice, Noul or Score.',
};
export function DecisionKindPicker({ name, options, value, onChange, required }: UnionPickerProps) {
  return (
    <ChoiceGroup
      legend="Decision kind"
      name={name}
      layout="grid"
      required={required}
      choices={options.map((option) => ({
        key: option.value,
        value: option.value,
        checked: value === option.value,
        onSelect: () => onChange(option.value),
        label: option.label,
        description: COPY[option.label],
      }))}
    />
  );
}
