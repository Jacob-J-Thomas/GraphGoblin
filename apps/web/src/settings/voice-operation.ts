import { z } from 'zod';

const key = 'graphgoblin.voice-operation.v1';
const PendingSchema = z.object({
  operationId: z.uuid(),
  kind: z.enum(['probe', 'install']),
  probeRoute: z.enum(['local', 'cloud']).optional(),
  configRevision: z.number().int().nonnegative().optional(),
});
export type PendingVoiceOperation = z.infer<typeof PendingSchema>;

/** Only operation identity is retained. Keys, audio and transcripts never enter this store. */
export function readVoiceOperation(): PendingVoiceOperation | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = PendingSchema.safeParse(raw ? JSON.parse(raw) : undefined);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Must succeed before starting a potentially billable/installing operation. */
export function rememberVoiceOperation(operation: PendingVoiceOperation): void {
  sessionStorage.setItem(key, JSON.stringify(operation));
}

export function clearVoiceOperation(operationId: string): void {
  if (readVoiceOperation()?.operationId === operationId) sessionStorage.removeItem(key);
}
