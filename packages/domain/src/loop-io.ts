import {
  LoopDefinitionCompatibilitySchema,
  LoopExportCompatibilitySchema,
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

/** Wrap a definition in the portable export envelope. */
export function exportLoop(def: LoopDefinition, exportedAt: string): LoopExport {
  return {
    format: 'graphgoblin-loop',
    formatVersion: 1,
    exportedAt,
    loop: LoopDefinitionCompatibilitySchema.parse(def),
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
  const envelope =
    typeof input === 'object' &&
    input !== null &&
    ('format' in input || 'formatVersion' in input || 'exportedAt' in input || 'loop' in input);
  const parsed = envelope
    ? LoopExportCompatibilitySchema.safeParse(input)
    : LoopDefinitionCompatibilitySchema.safeParse(input);
  if (parsed.success) {
    const definition = 'loop' in parsed.data ? parsed.data.loop : parsed.data;
    return { definition, issues: validateLoop(definition) };
  }
  const errors = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
  throw new LoopImportError('document is neither a loop export nor a loop definition', { errors });
}
