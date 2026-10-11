/**
 * The parts of a schema-driven form that `formLayout` places: a run of fields, and the Advanced
 * disclosure with its headed sections and its summary of what it holds.
 */
import { createContext, type ComponentType } from 'react';
import { useWatch } from 'react-hook-form';
import { Badge, Disclosure, Fieldset, Legend, Tabs } from '../components/ui/index.js';
import { ADVANCED_KEY, useDisclosureState } from './disclosures.js';
import { Icon } from '../components/icons/index.js';
import { FieldError, useProblemCount, type FieldProps } from './fields/shared.js';
import {
  isCustomized,
  isOwned,
  placementsOf,
  type AdvancedSection,
  type LayoutItem,
  contextLayout,
  type FormLayout,
} from './layout.js';
import type { Schema } from './introspect.js';

/** Nested object bodies omit context fields only when the root supplies their separate panel. */
export const ContextPanelContext = createContext(false);

/**
 * Fields in order. A split object's fields sit in a block under the object's path, so an issue
 * about the object finds them, with the object's own message where `showsError` says.
 */
export function LayoutItems({
  items,
  keyPrefix,
  absentParent,
  Field,
}: {
  items: readonly LayoutItem[];
  keyPrefix: string;
  absentParent?: FieldProps['absentParent'];
  Field: ComponentType<FieldProps>;
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
                absentParent={absentParent}
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
            absentParent={absentParent}
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
  Field,
}: {
  sections: readonly AdvancedSection[];
  keyPrefix: string;
  Field: ComponentType<FieldProps>;
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
  const state = useDisclosureState(`${keyPrefix}${ADVANCED_KEY}`, false);
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
          <LayoutItems key="" items={section.items} keyPrefix={keyPrefix} Field={Field} />
        ) : (
          <Fieldset key={section.heading} variant="section">
            <Legend variant="section">{section.heading}</Legend>
            <LayoutItems items={section.items} keyPrefix={keyPrefix} Field={Field} />
          </Fieldset>
        ),
      )}
    </Disclosure>
  );
}

export function LayoutFields({
  layout,
  keyPrefix,
  absentParent,
  Field,
}: {
  layout: FormLayout;
  keyPrefix: string;
  absentParent?: FieldProps['absentParent'];
  Field: ComponentType<FieldProps>;
}) {
  return (
    <>
      <LayoutItems
        items={layout.basic}
        keyPrefix={keyPrefix}
        absentParent={absentParent}
        Field={Field}
      />
      {layout.advanced.length > 0 ? (
        <AdvancedFields sections={layout.advanced} keyPrefix={keyPrefix} Field={Field} />
      ) : null}
    </>
  );
}

/** One form and one set of bindings shared by the two mounted panels. */
export function FormPanels({
  schema,
  layout,
  keyPrefix,
  Field,
}: {
  schema: Schema;
  layout: FormLayout;
  keyPrefix: string;
  Field: ComponentType<FieldProps>;
}) {
  const value: unknown = useWatch();
  const context = contextLayout(schema, value);
  const hasContext = context.basic.length + context.advanced.length > 0;
  const state = useDisclosureState('#context-tab', false);
  const fields = context.basic.concat(context.advanced.flatMap((section) => section.items));
  const paths = placementsOf(fields).map((field) => field.name);
  const owners = fields.filter(isOwned).map((item) => item.owner);
  const contextProblems = useProblemCount(paths, owners);
  const allProblems = useProblemCount(['']);
  // Empty path means the whole form (handled explicitly by useProblemCount).
  const main = (
    <ContextPanelContext value={hasContext}>
      <LayoutFields layout={layout} keyPrefix={keyPrefix} Field={Field} />
    </ContextPanelContext>
  );
  return (
    <Tabs
      label="Node configuration"
      selected={hasContext && state.open ? 'context' : 'main'}
      onSelect={(id) => state.onOpenChange?.(id === 'context')}
      items={[
        {
          id: 'main',
          label: (
            <>
              Settings <ProblemBadge count={allProblems - contextProblems} />
            </>
          ),
          content: main,
        },
        ...(hasContext
          ? [
              {
                id: 'context',
                label: (
                  <>
                    Context <ProblemBadge count={contextProblems} />
                  </>
                ),
                content: (
                  <LayoutFields layout={context} keyPrefix={`${keyPrefix}:context`} Field={Field} />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** A shared summary of field problems for disclosures and tabs. */
export function ProblemBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge size="sm" tone="bad">
      <Icon name="alert" />
      {count} {count === 1 ? 'error' : 'errors'}
    </Badge>
  );
}
