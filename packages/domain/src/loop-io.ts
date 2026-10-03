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

/** Wrap a definition in the portable export envelope. */
export function exportLoop(def: LoopDefinition, exportedAt: string): LoopExport {
  return { format: 'graphgoblin-loop', formatVersion: 1, exportedAt, loop: def };
}

/**
 * Parse an export document (or a bare definition) into a validated definition.
 * Schema problems throw LoopImportError; structural issues are returned for the caller to show.
 */
export function importLoop(input: unknown): {
  definition: LoopDefinition;
  issues: ValidationIssue[];
} {
  const asExport = LoopExportSchema.safeParse(input);
  const asDefinition = asExport.success ? undefined : LoopDefinitionSchema.safeParse(input);
  if (asExport.success) {
    return { definition: asExport.data.loop, issues: validateLoop(asExport.data.loop) };
  }
  if (asDefinition?.success) {
    return { definition: asDefinition.data, issues: validateLoop(asDefinition.data) };
  }
  const errors = (asDefinition?.error ?? asExport.error).issues.map(
    (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
  );
  throw new LoopImportError('document is neither a loop export nor a loop definition', { errors });
}
