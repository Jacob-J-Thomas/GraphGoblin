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

/** The product name in user-facing text: `Claude`, `Codex`, otherwise the capitalised id. */
export function harnessDisplayName(harness: string): string {
  if (harness === 'claude') return 'Claude';
  if (harness === 'codex') return 'Codex';
  return harness.charAt(0).toUpperCase() + harness.slice(1);
}

/** One sentence saying what the no-turn check found, used when no more specific detail is known. */
export function readinessDetail(harness: string, state: HarnessReadinessState): string {
  const name = harnessDisplayName(harness);
  switch (state) {
    case 'ready':
      return `${name} CLI version, required options and sign-in passed; account model access is not tested.`;
    case 'cli-missing':
      return `${name} CLI was not found.`;
    case 'cli-incompatible':
      return `${name} CLI lacks a required capability.`;
    case 'auth':
      return `${name} sign-in is missing or invalid.`;
    case 'quota':
      return `${name} account usage limit reached.`;
    case 'transport':
      return `${name} could not reach its provider service.`;
    case 'unknown':
      return `${name} readiness could not be confirmed.`;
  }
}

/** The one next step for a failed state; each ends with retrying preflight, the check that clears it. */
export function readinessAction(
  harness: string,
  state: Exclude<HarnessReadinessState, 'ready'>,
): string {
  const name = harnessDisplayName(harness);
  switch (state) {
    case 'cli-missing':
      return `Install the ${name} CLI or set ${harness === 'claude' || harness === 'codex' ? `GG_${harness.toUpperCase()}_BINARY` : 'its binary path'}, then retry preflight.`;
    case 'cli-incompatible':
      return `Update the ${name} CLI, then retry preflight.`;
    case 'auth':
      return `Run ${harness === 'claude' ? 'claude auth login' : harness === 'codex' ? 'codex login' : `the ${name} login command`}, then retry preflight.`;
    case 'quota':
      return 'Wait for the usage limit to reset, then retry preflight.';
    case 'transport':
      return "Check the network connection and the provider's service status, then retry preflight.";
    case 'unknown':
      return `Check that the ${name} CLI starts and responds, then retry preflight.`;
  }
}

/** Problem text: one detail sentence (the given one, or the state's) and one action, never repeated. */
export function readinessMessage(
  harness: string,
  state: HarnessReadinessState,
  detail = readinessDetail(harness, state),
): string {
  return state === 'ready' ? detail : `${detail} ${readinessAction(harness, state)}`;
}

export function readinessFailure(
  harness: string,
  state: Exclude<HarnessReadinessState, 'ready'>,
  detail?: string,
): HarnessPreflight {
  return {
    state,
    ok: false,
    problems: [readinessMessage(harness, state, detail)],
  };
}
