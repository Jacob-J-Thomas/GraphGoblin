import { z } from 'zod';

/** Device-safe voice route details shared by Chat and owner setup contracts. */
export const VoiceRouteSchema = z.enum(['local', 'cloud']);
export const VoiceRouteInfoSchema = z.strictObject({
  ready: z.boolean(),
  route: VoiceRouteSchema.optional(),
  cloudProvider: z.literal('OpenAI').optional(),
  cloudFallbackAllowed: z.boolean(),
  message: z.string().max(1000),
});
export type VoiceRouteInfo = z.infer<typeof VoiceRouteInfoSchema>;
