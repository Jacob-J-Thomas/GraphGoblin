import { JsonValueSchema, type JsonValue } from '@graphgoblin/contracts';
import type { ProbeResponse, ScriptRunResult } from '@graphgoblin/engine';

export type PollProbeFailure =
  | 'POLL_PROBE_FAILED'
  | 'POLL_PROBE_TIMED_OUT'
  | 'POLL_STDOUT_OVERFLOW'
  | 'POLL_STDOUT_UNBOUNDED'
  | 'POLL_JSON_INVALID';
export class PollProbeError extends Error {
  constructor(readonly code: PollProbeFailure) {
    super(code);
    this.name = 'PollProbeError';
  }
}
function json(text: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PollProbeError('POLL_JSON_INVALID');
  }
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) throw new PollProbeError('POLL_JSON_INVALID');
  return parsed.data;
}
/** Only new items-mode polls select these stricter rules; legacy text/exit-code probes stay intact. */
export function itemsScriptProbe(result: ScriptRunResult): JsonValue {
  if (result.timedOut) throw new PollProbeError('POLL_PROBE_TIMED_OUT');
  if (result.exitCode !== 0) throw new PollProbeError('POLL_PROBE_FAILED');
  if (result.stdoutOverflow === true) throw new PollProbeError('POLL_STDOUT_OVERFLOW');
  if (result.stdoutOverflow !== false) throw new PollProbeError('POLL_STDOUT_UNBOUNDED');
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    // Process diagnostics are not persisted in the new items payload.
    stderr: '',
    json: json(result.stdout),
    timedOut: false,
  };
}
export function itemsHttpProbe(response: ProbeResponse): JsonValue {
  if (response.status < 200 || response.status >= 300)
    throw new PollProbeError('POLL_PROBE_FAILED');
  let value: JsonValue;
  if (response.json === undefined) value = json(response.body);
  else {
    const parsed = JsonValueSchema.safeParse(response.json);
    if (!parsed.success) throw new PollProbeError('POLL_JSON_INVALID');
    value = parsed.data;
  }
  return {
    status: response.status,
    headers: response.headers,
    body: response.body.slice(0, 65_536),
    json: value,
  };
}
