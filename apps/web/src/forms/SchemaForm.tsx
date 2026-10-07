import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type FieldValues, type Resolver } from 'react-hook-form';
import { FieldGroup, Label, Select } from '../components/ui/index.js';
import { FormChangeContext, nextChangeId, type ChangeScope, type FormChange } from './changes.js';
import {
  CollectionIdentitiesContext,
  createCollectionIdentities,
  createDisclosureIdentities,
  DisclosureStoreContext,
  type DisclosureStates,
  type DisclosureStore,
} from './disclosures.js';
import {
  FieldControlsContext,
  UnionPickersContext,
  type FieldControls,
  type UnionPickers,
} from './fields.js';
import { FieldIssuesContext, FormScopeContext, ProblemPathsContext } from './fields/shared.js';
import {
  humanize,
  initialValue,
  matchOption,
  optionLabel,
  shapeOf,
  type Schema,
} from './introspect.js';
import { formLayout } from './layout.js';
import {
  ParseErrorContext,
  repathParseErrors,
  type ParseError,
  type ParseErrorChannel,
  type ParseErrorReason,
} from './parse-errors.js';
import { AdvancedFields, LayoutItems } from './sections.js';
import { stripUnset } from './unset.js';

export interface SchemaFormProps {
  /** A Zod object or discriminated-union schema, for example a node kind's config schema. */
  schema: Schema;
  value: unknown;
  /**
   * Called with the raw form values after every change, valid or not, and what the change was:
   * the field's path and whether it was a discrete choice or typing (`FormChange`), which the
   * editor's undo history uses to make each choice a step and typing one step per field.
   */
  onChange: (value: unknown, change: FormChange) => void;
  /** Accessible name for the form. */
  label: string;
  /** Optional display order for top-level object fields; unspecified fields keep schema order. */
  fieldOrder?: readonly string[] | undefined;
  /** Stored text that did not parse (JSON), by field path; fields show it again when remounted. */
  parseErrors?: Record<string, ParseError> | undefined;
  /**
   * Called when a field's text stops or starts parsing (`undefined` clears the path); `reason` is
   * `'discard'` when the user dropped the text (Discard the unparsed text) rather than fixing it. `change` is
   * the change it belongs to: typing in that field, or the commit (a row's removal, say) that moved
   * or dropped it.
   */
  onParseError?: (
    path: string,
    error: ParseError | undefined,
    reason: ParseErrorReason | undefined,
    change: FormChange,
  ) => void;
  /**
   * Controls that draw fields in place of the default renderer, by the name a field's metadata
   * gives in `control` (`FieldControl`); a field naming no registered control is drawn as usual.
   */
  controls?: FieldControls | undefined;
  /** Custom discriminated-union pickers by relative dotted field path. */
  unionPickers?: UnionPickers | undefined;
  /**
   * Paths, relative to the form's value, of errors found outside the form (the loop's validation:
   * template and expression syntax, the API's checks). A collapsed Advanced group or list item
   * holding one says so, as it does for the form's own problems.
   */
  problems?: readonly string[] | undefined;
  /**
   * Which of the form's disclosures are open (the Advanced group, collapsible list items, a
   * control's own), when the caller keeps them: the node editor does, so the remount an undo or
   * redo causes keeps what the user opened. Without it the form keeps them itself, and each starts
   * from its default on every mount.
   */
  disclosures?: DisclosureStore | undefined;
}

const NO_CONTROLS: FieldControls = {};
const NO_UNION_PICKERS: UnionPickers = {};
const NO_PROBLEMS: readonly string[] = [];

interface Issue {
  path: string;
  message: string;
}

function issuesOf(schema: Schema, value: unknown): Issue[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function asValues(value: unknown): FieldValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

/** Reorder only the rendered top-level object shape, leaving the schema and field paths intact. */
function orderedShape(
  shape: Record<string, Schema>,
  fieldOrder: readonly string[] | undefined,
): Record<string, Schema> {
  if (!fieldOrder || fieldOrder.length === 0) return shape;
  const ordered: Record<string, Schema> = {};
  for (const key of [...fieldOrder, ...Object.keys(shape)]) {
    if (Object.hasOwn(ordered, key) || !Object.hasOwn(shape, key)) continue;
    const field = shape[key];
    if (field !== undefined) ordered[key] = field;
  }
  return ordered;
}

/**
 * A form generated from a Zod schema with react-hook-form and the Zod resolver. Every change is
 * reported upward as-is so the caller (the editor store) never loses input; schema issues are shown
 * inline per field and as a summary. Remount with a `key` to load a different value.
 *
 * The contracts' field metadata places the fields (`formLayout`): the basic ones first, in schema
 * order unless `fieldOrder` overrides the top-level object, then the advanced ones under a collapsed
 * Advanced disclosure, grouped under headings. The disclosure's state is the caller's (`disclosures`),
 * else the form's own, collapsed on each mount.
 */
export function SchemaForm({
  schema,
  value,
  onChange,
  label,
  parseErrors,
  onParseError,
  controls,
  unionPickers,
  problems,
  disclosures,
  fieldOrder,
}: SchemaFormProps) {
  const shape = shapeOf(schema);
  const id = useId();
  const [ownDisclosures, setOwnDisclosures] = useState<DisclosureStates>({});
  const [ownIdentities] = useState(createDisclosureIdentities);
  const [collections] = useState(() =>
    createCollectionIdentities(disclosures?.identities ?? ownIdentities, value),
  );
  const disclosureStore = useMemo<DisclosureStore>(
    () => disclosures ?? { open: ownDisclosures, setOpen: setOwnDisclosures },
    [disclosures, ownDisclosures],
  );
  const resolver = useMemo<Resolver<FieldValues>>(() => {
    const zod = zodResolver(schema as never) as unknown as Resolver<FieldValues>;
    return (values, context, options) => zod(stripUnset(values) as FieldValues, context, options);
  }, [schema]);
  const form = useForm<FieldValues>({ resolver, defaultValues: asValues(value), mode: 'onChange' });
  const [issues, setIssues] = useState<Issue[]>(() => issuesOf(schema, value));
  // The first issue at each path, for the fields react-hook-form does not control (record values).
  const issuesByPath = useMemo(() => {
    const byPath = new Map<string, string>();
    for (const issue of issues) if (!byPath.has(issue.path)) byPath.set(issue.path, issue.message);
    return byPath;
  }, [issues]);
  // The change under way (`ChangeScope`): its writes are reported with it.
  const pendingChangeRef = useRef<FormChange | undefined>(undefined);
  const changeScope = useMemo<ChangeScope>(
    () => (change, write) => {
      if (pendingChangeRef.current) return write();
      pendingChangeRef.current = { ...change, id: nextChangeId() };
      try {
        write();
      } finally {
        pendingChangeRef.current = undefined;
      }
    },
    [],
  );
  const parseErrorsRef = useRef(parseErrors);
  parseErrorsRef.current = parseErrors;
  const onParseErrorRef = useRef(onParseError);
  onParseErrorRef.current = onParseError;
  const tracked = onParseError !== undefined;
  const parseErrorChannel = useMemo<ParseErrorChannel>(
    () => {
      const update = (path: string, error: ParseError | undefined, reason?: ParseErrorReason) => {
        const current = parseErrorsRef.current?.[path];
        if (
          current?.message === error?.message &&
          current?.text === error?.text &&
          current?.input === error?.input
        )
          return;
        // Collection actions can clear and then reuse a path before React renders again.
        const { [path]: _previous, ...rest } = parseErrorsRef.current ?? {};
        parseErrorsRef.current = error ? { ...rest, [path]: error } : rest;
        // Outside any action, the text was typed in that field.
        const change = pendingChangeRef.current ?? { path, kind: 'typing', id: nextChangeId() };
        onParseErrorRef.current?.(path, error, reason, change);
      };
      return {
        get: (path) => parseErrorsRef.current?.[path],
        report: (path, error) => update(path, error),
        discard: (path) => update(path, undefined, 'discard'),
        tracked,
        errors: parseErrors,
      };
    },
    // `errors` is the stored state fields compare against to notice an external discard.
    [parseErrors, tracked],
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    void form.trigger();
    const subscription = form.watch((values, { name }) => {
      const next = stripUnset(values);
      collections.remember(next);
      setIssues(issuesOf(schema, next));
      // Every field describes its changes; a write that does not is a step of its own.
      const change = pendingChangeRef.current ?? {
        path: name ?? '',
        kind: 'commit',
        id: nextChangeId(),
      };
      onChangeRef.current(next, change);
    });
    return () => subscription.unsubscribe();
  }, [form, schema, collections]);

  const [unionIndex, setUnionIndex] = useState(() =>
    shape.kind === 'union' ? matchOption(shape.options, value, shape.discriminator) : 0,
  );
  const variantSchema = shape.kind === 'union' ? (shape.options[unionIndex] as Schema) : schema;
  const discriminator = shape.kind === 'union' ? shape.discriminator : undefined;
  const layout = useMemo(() => {
    const variant = shapeOf(variantSchema);
    return variant.kind === 'object'
      ? formLayout(orderedShape(variant.shape, fieldOrder), '', discriminator)
      : undefined;
  }, [variantSchema, discriminator, fieldOrder]);

  // A choice: one undo step, with the unparsed text of the fields it replaces.
  const switchVariant = (index: number) =>
    changeScope({ path: '', kind: 'commit' }, () => {
      if (shape.kind !== 'union') return;
      repathParseErrors(parseErrorChannel, [{ from: '' }]);
      const next = asValues(initialValue(shape.options[index] as Schema));
      collections.remember(next);
      setUnionIndex(index);
      form.reset(next);
      setIssues(issuesOf(schema, next));
      onChangeRef.current(next, pendingChangeRef.current!);
    });

  return (
    <FormChangeContext value={changeScope}>
      <CollectionIdentitiesContext value={collections}>
        <DisclosureStoreContext value={disclosureStore}>
          <ParseErrorContext value={parseErrorChannel}>
            <FieldIssuesContext value={issuesByPath}>
              <FieldControlsContext value={controls ?? NO_CONTROLS}>
                <UnionPickersContext value={unionPickers ?? NO_UNION_PICKERS}>
                  <ProblemPathsContext value={problems ?? NO_PROBLEMS}>
                    <FormScopeContext value={{ schema: variantSchema, id }}>
                      <FormProvider {...form}>
                        <form
                          aria-label={label}
                          noValidate
                          onSubmit={(e) => e.preventDefault()}
                          className="grid gap-field"
                        >
                          {shape.kind === 'union' ? (
                            <FieldGroup>
                              <Label htmlFor={id}>{humanize(shape.discriminator ?? 'kind')}</Label>
                              <Select
                                id={id}
                                value={String(unionIndex)}
                                onChange={(e) => switchVariant(Number(e.target.value))}
                              >
                                {shape.options.map((option, index) => (
                                  <option key={index} value={index}>
                                    {optionLabel(option, shape.discriminator)}
                                  </option>
                                ))}
                              </Select>
                            </FieldGroup>
                          ) : null}
                          {layout ? (
                            <LayoutItems items={layout.basic} keyPrefix={String(unionIndex)} />
                          ) : null}
                          {layout && layout.advanced.length > 0 ? (
                            <AdvancedFields
                              key={unionIndex}
                              sections={layout.advanced}
                              keyPrefix={String(unionIndex)}
                            />
                          ) : null}
                          {issues.length > 0 ? (
                            <div
                              className="grid gap-1 rounded-md border-l-4 border-status-bad-border bg-status-bad-bg px-3 py-2 text-xs leading-snug"
                              aria-label="Config issues"
                            >
                              <p className="font-semibold text-status-bad-fg">Config issues</p>
                              <ul className="list-disc pl-4">
                                {issues.map((issue, index) => (
                                  <li key={index}>
                                    {issue.path ? <code>{issue.path}</code> : 'config'}:{' '}
                                    {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </form>
                      </FormProvider>
                    </FormScopeContext>
                  </ProblemPathsContext>
                </UnionPickersContext>
              </FieldControlsContext>
            </FieldIssuesContext>
          </ParseErrorContext>
        </DisclosureStoreContext>
      </CollectionIdentitiesContext>
    </FormChangeContext>
  );
}
