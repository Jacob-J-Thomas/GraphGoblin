import {
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

export class LoopFormatUpgradeRequiredError extends DomainError {
  constructor() {
    super(
      'LOOP_FORMAT_UPGRADE_REQUIRED',
      'Use the offline graphgoblin-upgrade export command to convert this v1 document',
    );
  }
}

/** Wrap a definition in the portable export envelope. */
export function exportLoop(def: LoopDefinition, exportedAt: string): LoopExport {
  return {
    format: 'graphgoblin-loop',
    formatVersion: 2,
    exportedAt,
    loop: def,
  };
}

/**
 * Parse an export document (or a bare definition) into a validated definition.
 * Schema problems throw LoopImportError; structural issues are returned for the caller to show.
 */
export function importLoop(input: unknown): {
  definition: LoopDefinition;
  issues: ValidationIssue[];
} {
  if (
    typeof input === 'object' &&
    input !== null &&
    (('formatVersion' in input && input.formatVersion === 1) ||
      ('schemaVersion' in input && input.schemaVersion === 1))
  )
    throw new LoopFormatUpgradeRequiredError();
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
