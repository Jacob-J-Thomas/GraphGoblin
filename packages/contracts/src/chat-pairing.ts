import { z } from 'zod';

/** Owner-only enrollment prerequisites; this does not claim that model inference is ready. */
export const ChatPairingReadinessSchema = z.strictObject({
  ready: z.boolean(),
  mode: z.enum(['same-machine', 'network', 'unavailable']),
  url: z.url().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type ChatPairingReadiness = z.infer<typeof ChatPairingReadinessSchema>;
