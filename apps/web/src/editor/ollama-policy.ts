function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Policy fields incompatible with native Ollama; model and effort are independent choices. */
export function ollamaPolicyProblems(values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (
    values['session'] !== undefined &&
    !isUnset(values['session']) &&
    object(values['session'])['policy'] !== 'fresh'
  )
    problems.push('session');
  const options = object(values['harnessOptions']);
  if (options['sandbox'] !== 'read-only') problems.push('harnessOptions.sandbox');
  if (options['approval'] !== undefined && options['approval'] !== 'never')
    problems.push('harnessOptions.approval');
  for (const key of ['networkAccess', 'webSearch'])
    if (options[key] === true) problems.push(`harnessOptions.${key}`);
  if (Object.keys(object(options['configOverrides'])).length)
    problems.push('harnessOptions.configOverrides');
  if (Array.isArray(values['contextFiles']) && values['contextFiles'].length)
    problems.push('contextFiles');
  if (
    Object.values(object(values['capabilities'])).some(
      (value) => Array.isArray(value) && value.length,
    )
  )
    problems.push('capabilities');
  const schema = object(object(values['output'])['schema']);
  if (Object.keys(schema).length && object(schema['repair'])['enabled'] !== false)
    problems.push('output.schema.repair');
  return problems;
}

/** A user-requested bulk correction, applied by the form as one undoable edit. */
export function withOllamaLimits(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...values,
    session: { policy: 'fresh' },
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
  };
  delete next['contextFiles'];
  delete next['capabilities'];
  const output = object(values['output']);
  const schema = object(output['schema']);
  if (Object.keys(schema).length)
    next['output'] = {
      ...output,
      schema: { ...schema, repair: { ...object(schema['repair']), enabled: false } },
    };
  return next;
}
import { isUnset } from '../forms/unset.js';
