import type { HarnessPreflight, HarnessReadinessState } from '@graphgoblin/contracts';

/** Classify bounded CLI diagnostics ephemerally; never return executable output to a client. */
export function cliFailureState(text: string): HarnessReadinessState {
  // Version components and arbitrary numbers are not HTTP status evidence.
  const match =
    /\bHTTP(?:\/[\d.]+)?\s+([45]\d\d)\b|\bstatus(?:_code)?["']?\s*[:=]\s*([45]\d\d)\b|\bAPI Error:\s*([45]\d\d)\b/i.exec(
      text,
    );
  const status = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  // Connection evidence takes precedence over auth words in server/refresh diagnostics.
  if (
    /\beconn\w*\b|\benotfound\b|\betimedout\b|\beai_again\b|network|failed to connect|connection failed|stream disconnected|overloaded|temporarily unavailable/i.test(
      text,
    ) ||
    (status >= 500 && status <= 599)
  )
    return 'transport';
  if (status === 429 || /quota|usage[_ ]limit|rate[_ ]limit|too many requests/i.test(text))
    return 'quota';
  if (
    status === 401 ||
    status === 403 ||
    /not logged in|unauthori[sz]ed|authentication|authenticat|login required|token (has )?expired|invalid api key|please run \/login/i.test(
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
  return 'unknown';
}

export function readinessMessage(harness: string, state: HarnessReadinessState): string {
  switch (state) {
    case 'ready':
      return `${harness} CLI capabilities and local login passed. Account model access is not tested.`;
    case 'cli-missing':
      return `${harness} CLI could not be found. Install it or configure its binary path, then reload the page.`;
    case 'cli-incompatible':
      return `${harness} CLI lacks a required capability. Update the installed CLI and reload the page.`;
    case 'auth':
      return `${harness} authentication failed. Run ${harness === 'claude' ? 'claude auth login' : 'codex login'}, then reload the page.`;
    case 'quota':
      return `${harness} account usage limit reached. Check the account allowance and retry when it resets. The model selection is unchanged.`;
    case 'transport':
      return `${harness} connection or provider service failed. Check connectivity and service status, then retry. The model selection is unchanged.`;
    case 'unknown':
      return `${harness} readiness could not be confirmed. Check the installed CLI and reload the page; no model availability conclusion was made.`;
  }
}

export function readinessFailure(
  harness: string,
  state: Exclude<HarnessReadinessState, 'ready'>,
): HarnessPreflight {
  return {
    state,
    ok: false,
    problems: [readinessMessage(harness, state)],
  };
}
