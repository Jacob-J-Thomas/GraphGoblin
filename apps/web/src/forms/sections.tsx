/**
 * The parts of a schema-driven form that `formLayout` places: a run of fields, and the Advanced
 * disclosure with its headed sections and its summary of what it holds.
 */
import { useWatch } from 'react-hook-form';
import { Badge, Disclosure, Fieldset, Legend } from '../components/ui/index.js';
import { ADVANCED_KEY, useDisclosureState } from './disclosures.js';
import { Field } from './fields.js';
import { FieldError, useProblemCount } from './fields/shared.js';
import { ProblemBadge } from './fields/structure.js';
import {
  isCustomized,
  isOwned,
  placementsOf,
  type AdvancedSection,
  type LayoutItem,
} from './layout.js';

/**
 * Fields in order. A split object's fields sit in a block under the object's path, so an issue
 * about the object finds them, with the object's own message where `showsError` says.
 */
export function LayoutItems({
  items,
  keyPrefix,
}: {
  items: readonly LayoutItem[];
  keyPrefix: string;
}) {
  return (
    <>
      {items.map((item) =>
        isOwned(item) ? (
          <div
            key={`${keyPrefix}:${item.owner}:${item.fields[0]?.name ?? ''}`}
            data-field={item.owner}
            className="contents"
          >
            {item.fields.map((field) => (
              <Field
                key={`${keyPrefix}:${field.name}`}
                schema={field.schema}
                name={field.name}
                label={field.label}
              />
            ))}
            {item.showsError ? <FieldError name={item.owner} /> : null}
          </div>
        ) : (
          <Field
            key={`${keyPrefix}:${item.name}`}
            schema={item.schema}
            name={item.name}
            label={item.label}
          />
        ),
      )}
    </>
  );
}

/**
 * The advanced fields under a disclosure named Advanced, collapsed until opened (its state under
 * `ADVANCED_KEY` in the form's disclosure states), each group under its heading
 * (a section fieldset with a legend). Its toggle says how many of them hold a value of their own
 * ("2 set") and how many problems are inside ("1 error"), so a collapsed group never hides either.
 */
export function AdvancedFields({
  sections,
  keyPrefix,
}: {
  sections: readonly AdvancedSection[];
  keyPrefix: string;
}) {
  const placements = sections.flatMap((section) => placementsOf(section.items));
  const owners = sections.flatMap((section) =>
    section.items.filter(isOwned).flatMap((item) => (item.showsError ? [item.owner] : [])),
  );
  const values: unknown[] = useWatch({ name: placements.map((placement) => placement.name) });
  const set = placements.filter((placement, index) =>
    isCustomized(placement.schema, values[index]),
  ).length;
  const problems = useProblemCount(
    placements.map((placement) => placement.name),
    owners,
  );
  // Collapsed until opened; whoever keeps the form's disclosures keeps it across remounts.
  const state = useDisclosureState(ADVANCED_KEY, false);
  return (
    <Disclosure
      {...state}
      label="Advanced"
      summary={
        <>
          {set > 0 ? <Badge size="sm">{set} set</Badge> : null} <ProblemBadge count={problems} />
        </>
      }
    >
      {sections.map((section) =>
        section.heading === undefined ? (
          <LayoutItems key="" items={section.items} keyPrefix={keyPrefix} />
        ) : (
          <Fieldset key={section.heading} variant="section">
            <Legend variant="section">{section.heading}</Legend>
            <LayoutItems items={section.items} keyPrefix={keyPrefix} />
          </Fieldset>
        ),
      )}
    </Disclosure>
  );
}
