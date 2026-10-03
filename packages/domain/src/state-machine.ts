import type { Outcome, RunStatus } from '@graphgoblin/contracts';
import { TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import { InvalidTransitionError } from './errors.js';

export type RunAction =
  | { type: 'start' }
  | { type: 'park' }
  | { type: 'wake' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'fail' }
  | { type: 'finish'; outcome: Outcome }
  | { type: 'recover' };

const ACTIVE: readonly RunStatus[] = ['running', 'waiting', 'paused'];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function isActive(status: RunStatus): boolean {
  return ACTIVE.includes(status);
}

/**
 * Pure transition function for run status. Throws InvalidTransitionError on anything the
 * lifecycle in docs/05-execution-engine.md does not allow.
 */
export function transitionRun(status: RunStatus, action: RunAction): RunStatus {
  const fail = (): never => {
    throw new InvalidTransitionError(
      `cannot apply "${action.type}" to a run in status "${status}"`,
      { status, action },
    );
  };
  switch (action.type) {
    case 'start':
      return status === 'queued' ? 'running' : fail();
    case 'park':
      return status === 'running' ? 'waiting' : fail();
    case 'wake':
      return status === 'waiting' ? 'running' : fail();
    case 'pause':
      return status === 'running' || status === 'waiting' ? 'paused' : fail();
    case 'resume':
      return status === 'paused' || status === 'failed' ? 'running' : fail();
    case 'cancel':
      return status === 'queued' || isActive(status) ? 'cancelled' : fail();
    case 'fail':
      return status === 'running' || status === 'waiting' ? 'failed' : fail();
    case 'finish': {
      if (status !== 'running') return fail();
      switch (action.outcome) {
        case 'success':
          return 'succeeded';
        case 'failure':
          return 'failed';
        case 'exhausted':
          return 'exhausted';
      }
    }
    // eslint-disable-next-line no-fallthrough -- the inner switch is exhaustive
    case 'recover':
      return status === 'running' ? 'running' : fail();
  }
}

/** Map an outcome to the terminal status it produces. */
export function outcomeStatus(outcome: Outcome): RunStatus {
  switch (outcome) {
    case 'success':
      return 'succeeded';
    case 'failure':
      return 'failed';
    case 'exhausted':
      return 'exhausted';
  }
}
