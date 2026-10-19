import type { HarnessPreflight, HarnessReadinessState } from '@graphgoblin/contracts';

/** Classify bounded CLI diagnostics ephemerally; never return executable output to a client. */
export function cliFailureState(text: string): HarnessReadinessState {
  // Version components and arbitrary numbers are not HTTP status evidence.
  const match =
    /\bHTTP(?:\/[\d.]+)?\s+([45]\d\d)\b|\bstatus(?:_code)?["']?\s*[:=]\s*([45]\d\d)\b/i.exec(text);
  const status = Number(match?.[1] ?? match?.[2]);
  if (status === 429 || /quota|usage[_ ]limit|rate[_ ]limit|too many requests/i.test(text))
    return 'quota';
  if (
    status === 401 ||
    status === 403 ||
    /not logged in|unauthori[sz]ed|authentication|authenticat|login required|token (has )?expired/i.test(
      text,
    )
  )
    return 'auth';
  if (
    /unknown (option|argument)|unexpected argument|unrecognized (option|argument)|unsupported (option|flag)/i.test(
      text,
    )
  )
    return 'cli-incompatible';
  if (
    (status >= 500 && status <= 599) ||
    /econnreset|econnrefused|enotfound|network|connection failed|stream disconnected|overloaded|temporarily unavailable/i.test(
      text,
    )
  )
    return 'transport';
  return 'unknown';
}

export function readinessMessage(harness: string, state: HarnessReadinessState): string {
  switch (state) {
    case 'ready':
      return `${harness} CLI capabilities and local login passed. Account model access is not tested.`;
    case 'checking':
      return `Checking ${harness} CLI prerequisites; wait for the probe to finish.`;
    case 'cli-missing':
      return `${harness} CLI could not be found. Install it or configure its binary path, then retry preflight.`;
    case 'cli-incompatible':
      return `${harness} CLI lacks a required capability. Update the installed CLI and retry preflight.`;
    case 'auth':
      return `${harness} authentication failed. Run ${harness === 'claude' ? 'claude auth login' : 'codex login'}, then retry preflight.`;
    case 'quota':
      return `${harness} account usage limit reached. Check the account allowance and retry when it resets. The model selection is unchanged.`;
    case 'transport':
      return `${harness} connection or provider service failed. Check connectivity and service status, then retry. The model selection is unchanged.`;
    case 'unknown':
      return `${harness} readiness could not be confirmed. Check the installed CLI and retry preflight; no model availability conclusion was made.`;
  }
}

export function readinessFailure(
  harness: string,
  state: Exclude<HarnessReadinessState, 'ready'>,
): HarnessPreflight {
  return { state, ok: false, authenticated: false, problems: [readinessMessage(harness, state)] };
}
