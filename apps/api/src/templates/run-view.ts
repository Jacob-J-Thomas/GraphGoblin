import { z } from 'zod';
import {
  RunRecordSchema,
  TimestampSchema,
  UlidSchema,
  type RunRecord,
} from '@graphgoblin/contracts';
import { TemplateSubjectSchema, parseSubject } from './subjects.js';
import { TemplateError } from './errors.js';

export const TemplateRunSchema = RunRecordSchema.extend({
  templateSubject: TemplateSubjectSchema.optional(),
});
const CursorSchema = z.strictObject({ createdAt: TimestampSchema, id: UlidSchema });
export function encodeRunCursor(run: Pick<RunRecord, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: run.createdAt, id: run.id })).toString(
    'base64url',
  );
}
export function decodeRunCursor(cursor: string): z.infer<typeof CursorSchema> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid');
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('invalid');
    return CursorSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new TemplateError('INVALID_CURSOR', 'Choose a cursor returned by the run listing.', 400);
  }
}
export function templateRunView(run: RunRecord, subject: unknown) {
  return subject === null || subject === undefined
    ? run
    : { ...run, templateSubject: parseSubject(subject) };
}
