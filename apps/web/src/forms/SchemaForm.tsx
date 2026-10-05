import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type FieldValues, type Resolver } from 'react-hook-form';
import { FieldGroup, Label, Select } from '../components/ui/index.js';
import { FieldControlsContext, type FieldControls } from './fields.js';
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
  /** Called with the raw form values after every change, valid or not. */
  onChange: (value: unknown) => void;
  /** Accessible name for the form. */
  label: string;
  /** Stored text that did not parse (JSON), by field path; fields show it again when remounted. */
  parseErrors?: Record<string, ParseError> | undefined;
  /**
   * Called when a field's text stops or starts parsing (`undefined` clears the path); `reason` is
   * `'discard'` when the user dropped the text (Discard text) rather than fixing it.
   */
  onParseError?: (path: string, error: ParseError | undefined, reason?: ParseErrorReason) => void;
  /**
   * Controls that draw fields in place of the default renderer, by the name a field's metadata
   * gives in `control` (`FieldControl`); a field naming no registered control is drawn as usual.
   */
  controls?: FieldControls | undefined;
  /**
   * Paths, relative to the form's value, of errors found outside the form (the loop's validation:
   * template and expression syntax, the API's checks). A collapsed Advanced group or list item
   * holding one says so, as it does for the form's own problems.
   */
  problems?: readonly string[] | undefined;
}

const NO_CONTROLS: FieldControls = {};
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

/**
 * A form generated from a Zod schema with react-hook-form and the Zod resolver. Every change is
 * reported upward as-is so the caller (the editor store) never loses input; schema issues are shown
 * inline per field and as a summary. Remount with a `key` to load a different value.
 *
 * The contracts' field metadata places the fields (`formLayout`): the basic ones first, in schema
 * order, then the advanced ones under a collapsed Advanced disclosure, grouped under headings. The
 * disclosure's state is the form's own and starts collapsed on every mount.
 */
export function SchemaForm({
  schema,
  value,
  onChange,
  label,
  parseErrors,
  onParseError,
  controls,
  problems,
}: SchemaFormProps) {
  const shape = shapeOf(schema);
  const id = useId();
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
  const parseErrorsRef = useRef(parseErrors);
  parseErrorsRef.current = parseErrors;
  const onParseErrorRef = useRef(onParseError);
  onParseErrorRef.current = onParseError;
  const tracked = onParseError !== undefined;
  const parseErrorChannel = useMemo<ParseErrorChannel>(
    () => {
      const update = (path: string, error: ParseError | undefined, reason?: ParseErrorReason) => {
        const current = parseErrorsRef.current?.[path];
        if (current?.message === error?.message && current?.text === error?.text) return;
        // Collection actions can clear and then reuse a path before React renders again.
        const { [path]: _previous, ...rest } = parseErrorsRef.current ?? {};
        parseErrorsRef.current = error ? { ...rest, [path]: error } : rest;
        onParseErrorRef.current?.(path, error, reason);
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
    const subscription = form.watch((values) => {
      const next = stripUnset(values);
      setIssues(issuesOf(schema, next));
      onChangeRef.current(next);
    });
    return () => subscription.unsubscribe();
  }, [form, schema]);

  const [unionIndex, setUnionIndex] = useState(() =>
    shape.kind === 'union' ? matchOption(shape.options, value, shape.discriminator) : 0,
  );
  const variantSchema = shape.kind === 'union' ? (shape.options[unionIndex] as Schema) : schema;
  const discriminator = shape.kind === 'union' ? shape.discriminator : undefined;
  const layout = useMemo(() => {
    const variant = shapeOf(variantSchema);
    return variant.kind === 'object' ? formLayout(variant.shape, '', discriminator) : undefined;
  }, [variantSchema, discriminator]);

  const switchVariant = (index: number) => {
    if (shape.kind !== 'union') return;
    repathParseErrors(parseErrorChannel, [{ from: '' }]);
    const next = asValues(initialValue(shape.options[index] as Schema));
    setUnionIndex(index);
    form.reset(next);
    setIssues(issuesOf(schema, next));
    onChangeRef.current(next);
  };

  return (
    <ParseErrorContext value={parseErrorChannel}>
      <FieldIssuesContext value={issuesByPath}>
        <FieldControlsContext value={controls ?? NO_CONTROLS}>
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
                            {issue.path ? <code>{issue.path}</code> : 'config'}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </form>
              </FormProvider>
            </FormScopeContext>
          </ProblemPathsContext>
        </FieldControlsContext>
      </FieldIssuesContext>
    </ParseErrorContext>
  );
}
