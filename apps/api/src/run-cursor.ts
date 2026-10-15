import { z } from 'zod';
import { TimestampSchema, UlidSchema, type RunRecord } from '@graphgoblin/contracts';

const CursorSchema = z.strictObject({ createdAt: TimestampSchema, id: UlidSchema });

export function encodeRunCursor(run: Pick<RunRecord, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: run.createdAt, id: run.id })).toString(
    'base64url',
  );
}

/** Bounded canonical JSON and base64url; never decode template metadata. */
export function decodeRunCursor(cursor: string): z.infer<typeof CursorSchema> {
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid');
    const value = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (encodeRunCursor(value) !== cursor) throw new Error('invalid');
    return value;
  } catch {
    throw Object.assign(new Error('Choose a cursor returned by the run listing.'), {
      code: 'INVALID_CURSOR',
      statusCode: 400,
    });
  }
}
