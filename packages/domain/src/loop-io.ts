import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  LoopExportSchema,
  type LoopDefinition,
  type LoopExport,
} from '@graphgoblin/contracts';
import { DomainError } from './errors.js';
import { validateLoop, type ValidationIssue } from './graph.js';

export class LoopImportError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('LOOP_IMPORT_ERROR', message, details);
  }
}

/**
 * The document is a loop export or definition in a format this build does not read. Older
 * formats are refused, never converted (ADR-0040); `details` names the found and required format.
 */
export class LoopFormatUnsupportedError extends DomainError {
  constructor(
    readonly foundFormat: number,
    document: 'export' | 'definition',
  ) {
    super(
      'LOOP_FORMAT_UNSUPPORTED',
      `This loop ${document} is format ${String(foundFormat)}; this build reads only format ${String(CURRENT_DEFINITION_FORMAT)} and does not convert other formats. Re-create the loop in this build, or export it again from a build that writes format ${String(CURRENT_DEFINITION_FORMAT)}.`,
      { foundFormat, requiredFormat: CURRENT_DEFINITION_FORMAT },
    );
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The declared format of an export envelope (its `formatVersion`, then its loop's
 * `schemaVersion`) or of a bare definition, when it is a number.
 */
function declaredFormat(
  input: unknown,
): { found: number; document: 'export' | 'definition' } | undefined {
  if (!isObject(input)) return undefined;
  if (input.format === 'graphgoblin-loop' && typeof input.formatVersion === 'number') {
    if (input.formatVersion !== CURRENT_DEFINITION_FORMAT)
      return { found: input.formatVersion, document: 'export' };
    return isObject(input.loop) && typeof input.loop.schemaVersion === 'number'
      ? { found: input.loop.schemaVersion, document: 'export' }
      : undefined;
  }
  return typeof input.schemaVersion === 'number'
    ? { found: input.schemaVersion, document: 'definition' }
    : undefined;
}

/** Wrap a definition in the portable export envelope. */
export function exportLoop(def: LoopDefinition, exportedAt: string): LoopExport {
  return {
    format: 'graphgoblin-loop',
    formatVersion: CURRENT_DEFINITION_FORMAT,
    exportedAt,
    loop: def,
  };
}

/**
 * Parse an export document (or a bare definition) into a validated definition. A document that
 * declares another format throws LoopFormatUnsupportedError; other schema problems throw
 * LoopImportError; structural issues are returned for the caller to show.
 */
export function importLoop(input: unknown): {
  definition: LoopDefinition;
  issues: ValidationIssue[];
} {
  const declared = declaredFormat(input);
  if (declared && declared.found !== CURRENT_DEFINITION_FORMAT)
    throw new LoopFormatUnsupportedError(declared.found, declared.document);
  const envelope =
    typeof input === 'object' &&
    input !== null &&
    ('format' in input || 'formatVersion' in input || 'exportedAt' in input || 'loop' in input);
  const parsed = envelope
    ? LoopExportSchema.safeParse(input)
    : LoopDefinitionSchema.safeParse(input);
  if (parsed.success) {
    const definition = 'loop' in parsed.data ? parsed.data.loop : parsed.data;
    return { definition, issues: validateLoop(definition) };
  }
  const errors = parsed.error.issues.flatMap((issue) => {
    const paths =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => [...issue.path, key])
        : [issue.path];
    return paths.map((path) => `${path.join('.') || '<root>'}: ${issue.message}`);
  });
  throw new LoopImportError('document is neither a loop export nor a loop definition', { errors });
}
