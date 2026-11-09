import { GraphGoblinApiError, type GraphGoblinClient } from '@graphgoblin/api-client';
import {
  VoiceConfigUpdateSchema,
  VoiceLoopPreviewSchema,
  VoiceInstallRequestSchema,
  VoiceOperationSchema,
  VoicePreviewRequestSchema,
  VoicePreviewSchema,
  VoiceProbeRequestSchema,
  VoiceSetupSchema,
  VoiceStageRequestSchema,
  VoiceStageSchema,
} from '@graphgoblin/contracts';
import { z } from 'zod';

export const voiceSetupKey = ['voice-setup'] as const;
export const voiceLoopsKey = ['voice-loops'] as const;
export type VoiceConfigUpdate = z.infer<typeof VoiceConfigUpdateSchema>;
export type VoiceLoopPreview = z.infer<typeof VoiceLoopPreviewSchema>;
export type VoicePreview = z.infer<typeof VoicePreviewSchema>;

/** Owner-only voice setup. Uses the management client's live authorization and never stores keys. */
async function request<T>(
  client: GraphGoblinClient,
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers(client.config.headers);
  headers.set('accept', 'application/json');
  if (body !== undefined) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await client.config.fetch(
      new Request(`${client.config.baseUrl}/chat/voice${path}`, {
        method,
        headers,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw GraphGoblinApiError.network(error);
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw GraphGoblinApiError.fromResponse(response, value);
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new GraphGoblinApiError({ status: 502, code: 'VOICE_RESPONSE_INVALID' });
  return parsed.data;
}

export const voiceSetup = {
  get: (client: GraphGoblinClient, signal?: AbortSignal) =>
    request(client, 'GET', '/config', VoiceSetupSchema, undefined, signal),
  configure: (client: GraphGoblinClient, value: VoiceConfigUpdate) =>
    request(client, 'PUT', '/config', VoiceSetupSchema, VoiceConfigUpdateSchema.parse(value)),
  install: (client: GraphGoblinClient, value: z.infer<typeof VoiceInstallRequestSchema>) =>
    request(
      client,
      'POST',
      '/install',
      VoiceOperationSchema,
      VoiceInstallRequestSchema.parse(value),
    ),
  probe: (client: GraphGoblinClient, value: z.infer<typeof VoiceProbeRequestSchema>) =>
    request(client, 'POST', '/probe', VoiceOperationSchema, VoiceProbeRequestSchema.parse(value)),
  operation: (
    client: GraphGoblinClient,
    kind: 'probe' | 'install',
    operationId: string,
    signal?: AbortSignal,
  ) =>
    request(
      client,
      'GET',
      `/${kind === 'probe' ? 'probes' : 'installs'}/${encodeURIComponent(operationId)}`,
      VoiceOperationSchema,
      undefined,
      signal,
    ),
  loops: async (client: GraphGoblinClient, signal?: AbortSignal) =>
    (
      await request(
        client,
        'GET',
        '/loops',
        z.object({ items: z.array(VoiceLoopPreviewSchema) }),
        undefined,
        signal,
      )
    ).items,
  preview: (client: GraphGoblinClient, value: z.infer<typeof VoicePreviewRequestSchema>) =>
    request(client, 'POST', '/preview', VoicePreviewSchema, VoicePreviewRequestSchema.parse(value)),
  stage: (client: GraphGoblinClient, value: z.infer<typeof VoiceStageRequestSchema>) =>
    request(client, 'POST', '/stage', VoiceStageSchema, VoiceStageRequestSchema.parse(value)),
};

/** These refusals require an authored loop edit, rather than refreshing the same preview. */
export function voiceErrorNeedsEditor(error: unknown): boolean {
  return (
    error instanceof GraphGoblinApiError &&
    (error.code === 'VOICE_PREVIEW_INVALID' || error.code === 'VOICE_PRESET_PROMPT_UNSUPPORTED')
  );
}

/** Runtime/provider diagnostics can contain private paths; setup presents one useful next step. */
export function voiceErrorMessage(error: unknown): string {
  if (error instanceof GraphGoblinApiError) {
    if (error.status === 401 || error.status === 403)
      return 'Use the gateway owner key to change Voice settings.';
    if (error.code === 'VOICE_PREVIEW_INVALID')
      return 'The voice preset cannot safely edit this loop. Review the loop in the editor.';
    if (error.code === 'VOICE_PRESET_PROMPT_UNSUPPORTED')
      return 'A prompt that reads raw input can miss voice transcripts. Review this loop’s respond prompt in the editor and make it read normalized text before adding voice.';
    if (error.code === 'VOICE_CLOUD_DISCLOSURE_REQUIRED')
      return 'Confirm the test sample upload and provider billing before testing OpenAI.';
    if (error.code === 'VOICE_OPERATION_CAPACITY')
      return 'Voice setup history is full on this gateway. Existing checks still work; review its operation-history capacity before starting another test or install.';
    if (error.code === 'VOICE_OPERATION_RETIRED')
      return 'This operation’s detailed result is no longer available. Check Voice settings and any provider billing before explicitly starting a new test or install. This operation will not be restarted.';
    if (error.code === 'VOICE_PROBE_STALE')
      return 'Voice settings or local health changed during this test. Check the current setup, then explicitly run a new sample test.';
    if (error.status === 409)
      return 'Voice settings or this loop changed. Check again before continuing.';
    if (error.status === 429 || error.code === 'VOICE_CLOUD_RATE_LIMITED')
      return 'The provider is busy or its limit was reached. Try the test again later.';
    if (
      error.code === 'VOICE_CLOUD_AUTH' ||
      error.code === 'VOICE_CREDENTIAL_INVALID' ||
      error.code === 'VOICE_CLOUD_CREDENTIAL_INVALID'
    )
      return 'OpenAI could not verify this key. Re-enter the key and test again.';
    if (error.code === 'VOICE_LOCAL_UNAVAILABLE' || error.code === 'VOICE_LOCAL_MISSING')
      return 'The local voice engine is unavailable. Install it here or choose Cloud provider.';
    if (error.code === 'VOICE_RUNTIME_UNSUPPORTED')
      return 'This gateway’s local runtime has not been verified. Choose Cloud provider to continue.';
    if (error.code === 'VOICE_OPERATION_INTERRUPTED')
      return 'The gateway restarted before this check finished. Its outcome is uncertain; review the provider account before starting another cloud test.';
    if (error.code === 'VOICE_CLOUD_OUTCOME_UNCERTAIN')
      return 'OpenAI did not confirm the test outcome. Check your provider account before starting another test; audio was not sent to a different provider.';
    if (error.status === 0)
      return 'Couldn’t reach this gateway. Check the connection, then check setup again.';
  }
  return 'Couldn’t complete voice setup. Check setup again, or choose another route.';
}
