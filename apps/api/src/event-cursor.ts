import { z } from 'zod';
import { TimestampSchema, UlidSchema } from '@graphgoblin/contracts';
import type { InboundEventRecord } from '@graphgoblin/infrastructure/sqlite';

const CursorSchema = z.strictObject({ receivedAt: TimestampSchema, id: UlidSchema });

export function encodeEventCursor(event: Pick<InboundEventRecord, 'receivedAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ receivedAt: event.receivedAt, id: event.id })).toString(
    'base64url',
  );
}

/** Bounded canonical JSON and base64url; a cursor identifies an inbound-event position. */
export function decodeEventCursor(cursor: string): z.infer<typeof CursorSchema> {
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid');
    const value = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (encodeEventCursor(value) !== cursor) throw new Error('invalid');
    return value;
  } catch {
    throw Object.assign(new Error('Choose a cursor returned by the inbound event listing.'), {
      code: 'INVALID_CURSOR',
      statusCode: 400,
    });
  }
}
