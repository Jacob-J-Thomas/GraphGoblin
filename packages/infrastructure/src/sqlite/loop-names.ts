import { isStorableLoopName, MAX_LOOP_NAME_LENGTH } from '@graphgoblin/contracts';
import { eq } from 'drizzle-orm';
import type { SqliteTransaction } from './db.js';
import { loops } from './schema.js';

function collapseWhitespace(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

/** The display spelling is stored verbatim. This key only decides equivalence. */
export function loopNameKey(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}

export class LoopNameConflictError extends Error {
  constructor(readonly suggestedName: string) {
    super(`A loop with an equivalent name already exists. Try ${JSON.stringify(suggestedName)}.`);
    this.name = 'LoopNameConflictError';
  }
}

export class InvalidLoopNameError extends Error {
  constructor() {
    super('A loop name must contain well-formed Unicode text without NUL.');
    this.name = 'InvalidLoopNameError';
  }
}

/** Only call within the SQLite write transaction that will insert or rename the loop. */
export async function admitLoopName(
  tx: SqliteTransaction,
  ownerId: string,
  name: string,
  options: { exceptLoopId?: string; chooseAvailable?: boolean } = {},
): Promise<string> {
  if (!isStorableLoopName(name)) throw new InvalidLoopNameError();
  const rows = await tx
    .select({ id: loops.id, name: loops.name })
    .from(loops)
    .where(eq(loops.ownerId, ownerId));
  const used = new Set(
    rows.filter((row) => row.id !== options.exceptLoopId).map((row) => loopNameKey(row.name)),
  );
  if (!used.has(loopNameKey(name))) return name;

  // Suggestions stay within the existing UTF-16 length bound, including the suffix.
  const base = collapseWhitespace(name) || 'Loop';
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const prefix = base
      .slice(0, MAX_LOOP_NAME_LENGTH - suffix.length)
      .replace(/[\uD800-\uDBFF]$/u, '')
      .trimEnd();
    const candidate = prefix + suffix;
    if (used.has(loopNameKey(candidate))) continue;
    if (options.chooseAvailable) return candidate;
    throw new LoopNameConflictError(candidate);
  }
}
