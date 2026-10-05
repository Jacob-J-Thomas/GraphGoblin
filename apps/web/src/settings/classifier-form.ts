/**
 * The custom classifier form's values and their checks. Validity comes from the contract
 * (`ClassifierModelIdSchema` and `ClassifierModelPutSchema`), so the form accepts exactly what PUT
 * `/classifier-models/{id}` accepts; this module only puts the contract's findings into plain
 * sentences beside the field they concern.
 */
import {
  ClassifierModelIdSchema,
  ClassifierModelPutSchema,
  type ClassifierModelPut,
  type ClassifierModelSummary,
} from '@graphgoblin/contracts';

export type ClassifierPrimitive = ClassifierModelPut['primitives'][number];

/** The capabilities in the order the form lists them, with their display names. */
export const PRIMITIVES: readonly { value: ClassifierPrimitive; label: string }[] = [
  { value: 'choice', label: 'Choice / classification' },
  { value: 'noul', label: 'Noul' },
  { value: 'score', label: 'Score' },
];

/** How a capability reads in Settings and the picker; classification is a use of Choice. */
export function primitiveLabel(value: ClassifierPrimitive): string {
  return PRIMITIVES.find((p) => p.value === value)?.label ?? value;
}

export interface ClassifierFormValues {
  id: string;
  displayName: string;
  providerModel: string;
  endpoint: string;
  primitives: ClassifierPrimitive[];
  /** A secret's name, or '' for none. */
  secretRef: string;
}

export type ClassifierFormField = keyof ClassifierFormValues;
export type ClassifierFormErrors = Partial<Record<ClassifierFormField, string>>;

/** The fields in the order the form shows them, for focusing the first one with a problem. */
export const FORM_FIELDS: readonly ClassifierFormField[] = [
  'id',
  'displayName',
  'providerModel',
  'endpoint',
  'primitives',
  'secretRef',
];

/** A new entry's starting values, or an existing entry's metadata for editing. */
export function initialValues(entry?: ClassifierModelSummary): ClassifierFormValues {
  return {
    id: entry?.id ?? '',
    displayName: entry?.displayName ?? '',
    providerModel: entry?.providerModel ?? '',
    endpoint: entry?.endpoint ?? '',
    primitives: entry ? [...entry.primitives] : ['choice'],
    secretRef: entry?.secretRef ?? '',
  };
}

/** The PUT body for these values: custom HTTP metadata, with no secret reference when none. */
export function toPut(values: ClassifierFormValues): ClassifierModelPut {
  return {
    displayName: values.displayName,
    providerModel: values.providerModel,
    endpoint: values.endpoint,
    primitives: PRIMITIVES.map((p) => p.value).filter((p) => values.primitives.includes(p)),
    provider: 'http',
    ...(values.secretRef ? { secretRef: values.secretRef } : {}),
  };
}

interface Issue {
  code: string;
  message: string;
  path: PropertyKey[];
}

const ENDPOINT_EXAMPLE = 'http://127.0.0.1:8008';

/** The contract's own endpoint refinements, by the start of their messages. */
const ENDPOINT_REFINEMENTS: readonly [prefix: string, sentence: string][] = [
  ['endpoint must not contain whitespace', 'Remove the spaces or the malformed % encoding.'],
  ['endpoint must not use port 0', 'Use a port other than 0.'],
  [
    'endpoint must be an API root, without the /v1/systemone',
    'Enter the API root only; GraphGoblin adds /v1/systemone itself.',
  ],
  [
    'An endpoint with secretRef must use HTTPS',
    'With a bearer secret, use https:// unless the host is loopback (localhost, 127.0.0.0/8, or [::1]).',
  ],
];

const ROOT_REFINEMENT = 'endpoint must be an HTTP(S) API root';

function endpointSentence(issues: Issue[], endpoint: string): string {
  if (endpoint.trim() === '') return `Enter the endpoint's API root, such as ${ENDPOINT_EXAMPLE}.`;
  if (issues.some((i) => i.code === 'too_big')) return 'Use at most 4,096 characters.';
  for (const [prefix, sentence] of ENDPOINT_REFINEMENTS)
    if (issues.some((i) => i.message.startsWith(prefix))) return sentence;
  if (issues.some((i) => i.code === 'invalid_format'))
    return `Enter an http:// or https:// URL, such as ${ENDPOINT_EXAMPLE}.`;
  if (issues.some((i) => i.message.startsWith(ROOT_REFINEMENT)))
    return 'Use an API root without a user name or password, a query (?), or a fragment (#).';
  // A rule this form does not know yet: the contract's own words.
  return issues[0]!.message;
}

function textSentence(
  issues: Issue[],
  { empty, max }: { empty: string; max: number },
): string | undefined {
  if (issues.length === 0) return undefined;
  return issues.some((i) => i.code === 'too_big') ? `Use at most ${max} characters.` : empty;
}

function idSentence(id: string, existing: readonly string[]): string | undefined {
  if (id === '') return 'Enter an id.';
  if (!ClassifierModelIdSchema.safeParse(id).success)
    return 'Start with a lowercase letter, then use lowercase letters, digits, _ . or - (up to 64 characters).';
  if (id === 'jev') return 'jev is the built-in Jev model; choose another id.';
  if (existing.includes(id)) return `A classifier with id ${id} already exists; edit it instead.`;
  return undefined;
}

/**
 * The problems with `values`, by field, in plain sentences; empty when PUT would accept them.
 * `existingIds` are the catalog's ids, which a new entry may not reuse (PUT would replace that
 * entry); `isNew` is false when editing, where the id cannot change and is not checked.
 */
export function validateClassifier(
  values: ClassifierFormValues,
  { existingIds = [], isNew }: { existingIds?: readonly string[]; isNew: boolean },
): ClassifierFormErrors {
  const errors: ClassifierFormErrors = {};
  if (isNew) {
    const id = idSentence(values.id, existingIds);
    if (id) errors.id = id;
  }
  const parsed = ClassifierModelPutSchema.safeParse(toPut(values));
  const issues: Issue[] = parsed.success ? [] : parsed.error.issues;
  const at = (field: string) => issues.filter((i) => i.path[0] === field);
  // The contract checks the bearer rule only once every other field is valid; check the endpoint
  // with a secret on its own too, so its message shows while other fields are still being filled.
  const endpointIssues = at('endpoint');
  if (endpointIssues.length === 0 && values.secretRef) {
    const alone = ClassifierModelPutSchema.safeParse(
      toPut({ ...values, displayName: 'x', providerModel: 'x', primitives: ['choice'] }),
    );
    if (!alone.success) endpointIssues.push(...alone.error.issues);
  }
  const displayName = textSentence(at('displayName'), { empty: 'Enter a display name.', max: 120 });
  if (displayName) errors.displayName = displayName;
  const providerModel = textSentence(at('providerModel'), {
    empty: 'Enter the model name the endpoint expects, such as kev-latest.',
    max: 256,
  });
  if (providerModel) errors.providerModel = providerModel;
  if (endpointIssues.length > 0)
    errors.endpoint = endpointSentence(endpointIssues, values.endpoint);
  if (at('primitives').length > 0) errors.primitives = 'Choose at least one capability.';
  // The secret comes from the Secrets list, whose names already follow the contract's rule.
  return errors;
}
