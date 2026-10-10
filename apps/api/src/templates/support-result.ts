import { z } from 'zod';
/** A deterministic refusal carries no authority, including at authority-producing actions. */
export const SUPPORT_BLOCKED_MESSAGE = 'Support stopped safely; inspect the recorded support code.';
export const SupportBlockedSchema = z.strictObject({
  type: z.literal('SupportBlocked'),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
  message: z.literal(SUPPORT_BLOCKED_MESSAGE),
});
export function supportBlocked(code: string) {
  return SupportBlockedSchema.parse({
    type: 'SupportBlocked',
    code,
    message: SUPPORT_BLOCKED_MESSAGE,
  });
}
