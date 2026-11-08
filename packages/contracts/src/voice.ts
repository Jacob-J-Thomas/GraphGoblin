import { z } from 'zod';
import { TimestampSchema, UlidSchema } from './common.js';
import { LoopDefinitionSchema } from './loop.js';
import { VoiceRouteInfoSchema, VoiceRouteSchema } from './voice-route.js';
export { VoiceRouteInfoSchema, VoiceRouteSchema } from './voice-route.js';
export type { VoiceRouteInfo } from './voice-route.js';

export const VOICE_CONFIG_KEY = 'chat.voice.v1';
export const VOICE_NORMALIZER_COMMAND = 'graphgoblin-voice-normalize';
export const VoiceConfigSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  mode: z.enum(['auto', 'local', 'cloud']),
  cloudFallbackAllowed: z.boolean(),
  local: z
    .strictObject({
      executable: z.string().min(1).max(4096),
      modelPath: z.string().min(1).max(4096),
    })
    .optional(),
  cloud: z
    .strictObject({
      provider: z.literal('openai'),
      model: z.literal('gpt-transcribe'),
      secretName: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    })
    .optional(),
});
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export const VoiceProbeSchema = z.strictObject({
  route: VoiceRouteSchema,
  configRevision: z.number().int().nonnegative(),
  checkedAt: TimestampSchema,
  fingerprint: z.string(),
  suitable: z.boolean(),
  latencyMs: z.number().nonnegative(),
  freeMemoryBytes: z.number().nonnegative(),
  message: z.string().max(1000),
  transcript: z.string().max(16000).optional(),
});
export type VoiceProbe = z.infer<typeof VoiceProbeSchema>;
export const VoiceSetupSchema = z.strictObject({
  config: VoiceConfigSchema,
  route: VoiceRouteInfoSchema,
  local: z.strictObject({
    available: z.boolean(),
    installSupported: z.boolean(),
    downloadBytes: z.number().int().nonnegative(),
    message: z.string(),
    executable: z.string().optional(),
    modelPath: z.string().optional(),
  }),
  probes: z.array(VoiceProbeSchema),
  secrets: z.array(z.strictObject({ name: z.string(), compatible: z.boolean() })),
  install: z.strictObject({
    state: z.enum(['idle', 'installing', 'ready', 'failed']),
    phase: z.string(),
    downloadedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().optional(),
    message: z.string().optional(),
  }),
});
export type VoiceSetup = z.infer<typeof VoiceSetupSchema>;
export const VoiceConfigUpdateSchema = VoiceConfigSchema.omit({ revision: true }).extend({
  expectedRevision: z.number().int().nonnegative(),
});
export const VoiceProbeRequestSchema = z.strictObject({
  operationId: z.uuid(),
  route: VoiceRouteSchema,
  expectedConfigRevision: z.number().int().nonnegative(),
  cloudUploadAcknowledged: z.boolean().optional(),
});
export const VoicePreviewRequestSchema = z.strictObject({
  loopId: UlidSchema,
  expectedDraftHash: z.string().regex(/^[a-f0-9]{16}$/),
  expectedConfigRevision: z.number().int().nonnegative(),
});
export const VoiceLoopPreviewSchema = z.strictObject({
  loopId: UlidSchema,
  definitionHash: z.string(),
  published: z.boolean(),
  hasNormalizer: z.boolean(),
  classification: z.enum(['standard', 'customized', 'current']),
  label: z.string(),
});
export const VoicePreviewSchema = z.strictObject({
  loopId: UlidSchema,
  baseHash: z.string(),
  configRevision: z.number().int().nonnegative(),
  previewHash: z.string().regex(/^[a-f0-9]{16}$/),
  definition: z.lazy(() => LoopDefinitionSchema),
  message: z.string(),
});

export const VoiceStageRequestSchema = VoicePreviewRequestSchema.extend({
  expectedPreviewHash: z.string().regex(/^[a-f0-9]{16}$/),
});
export const VoiceStageSchema = z.strictObject({
  loopId: UlidSchema,
  draftHash: z.string(),
  editorUrl: z.string(),
});

export const VoiceOperationSchema = z.strictObject({
  operationId: z.uuid(),
  kind: z.enum(['probe', 'install']),
  state: z.enum(['running', 'succeeded', 'failed']),
  code: z.string().optional(),
  probe: VoiceProbeSchema.optional(),
  install: z
    .strictObject({
      phase: z.string(),
      downloadedBytes: z.number().nonnegative(),
      totalBytes: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type VoiceOperation = z.infer<typeof VoiceOperationSchema>;
export const VoiceInstallRequestSchema = z.strictObject({
  operationId: z.uuid(),
  expectedConfigRevision: z.number().int().nonnegative(),
  modelId: z.enum(['tiny.en', 'base.en']),
});
