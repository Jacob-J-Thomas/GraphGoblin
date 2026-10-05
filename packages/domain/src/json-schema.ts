import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormatsImport from 'ajv-formats';
import type { JsonSchema } from '@graphgoblin/contracts';

// ajv-formats is CommonJS; under NodeNext the default import is the plugin function itself.
const addFormats = addFormatsImport as unknown as (instance: Ajv) => Ajv;

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const cache = new Map<string, ValidateFunction>();
const CACHE_LIMIT = 256;

/** One problem with a value, located: what a form needs to put the message beside its field. */
export interface SchemaIssue {
  /**
   * Where the problem is, as property names and array indexes from the root (JSON Pointer
   * segments, unescaped). A missing required property ends with that property's name.
   */
  path: string[];
  /** What is wrong there, without the path: "must be integer", "is required". */
  message: string;
}

export interface SchemaValidation {
  ok: boolean;
  /** One line per problem, led by its JSON Pointer ("/n must be >= 1"). */
  errors: string[];
  /** The same problems, located (empty when `ok`). */
  issues: SchemaIssue[];
}

function stableKey(schema: JsonSchema): string {
  return stableStringify(schema);
}

/** Deterministic JSON serialisation with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function compileSchema(schema: JsonSchema): ValidateFunction {
  const key = stableKey(schema);
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = ajv.compile(schema);
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, compiled);
  return compiled;
}

/** Validate a value against a JSON Schema. Compilation errors are reported as validation errors. */
export function validateJson(schema: JsonSchema, value: unknown): SchemaValidation {
  let validate: ValidateFunction;
  try {
    validate = compileSchema(schema);
  } catch (error) {
    const message = `invalid schema: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, errors: [message], issues: [{ path: [], message }] };
  }
  const ok = validate(value);
  if (ok) return { ok: true, errors: [], issues: [] };
  const found = validate.errors ?? [];
  const errors = found.map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`.trim());
  return { ok: false, errors, issues: found.map(issueOf) };
}

/** JSON Pointer segments, unescaped (`~1` is `/`, `~0` is `~`). */
function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** An Ajv error as a located issue; a missing property (`required`) is located at itself. */
function issueOf(error: ErrorObject): SchemaIssue {
  const path = pointerSegments(error.instancePath);
  const missing = (error.params as { missingProperty?: unknown }).missingProperty;
  if (typeof missing === 'string') return { path: [...path, missing], message: 'is required' };
  return { path, message: error.message ?? 'is invalid' };
}

/** FNV-1a 64-bit hash of the stable serialisation, as 16 hex characters. Browser-safe. */
export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = BigInt('0xffffffffffffffff');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
