import { describe, expect, it } from 'vitest';
import type { RunStatus } from '@graphgoblin/contracts';
import { InvalidTransitionError } from './errors.js';
import {
  isActive,
  isTerminal,
  outcomeStatus,
  transitionRun,
  type RunAction,
} from './state-machine.js';

const ALL: RunStatus[] = [
  'queued',
  'running',
  'waiting',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
  'exhausted',
];

describe('transitionRun', () => {
  it('follows the documented lifecycle', () => {
    expect(transitionRun('queued', { type: 'start' })).toBe('running');
    expect(transitionRun('running', { type: 'park' })).toBe('waiting');
    expect(transitionRun('waiting', { type: 'wake' })).toBe('running');
    expect(transitionRun('running', { type: 'pause' })).toBe('paused');
    expect(transitionRun('waiting', { type: 'pause' })).toBe('paused');
    expect(transitionRun('paused', { type: 'resume' })).toBe('running');
    expect(transitionRun('failed', { type: 'resume' })).toBe('running');
    expect(transitionRun('paused', { type: 'resume', parked: true })).toBe('waiting');
    expect(transitionRun('queued', { type: 'cancel' })).toBe('cancelled');
    expect(transitionRun('waiting', { type: 'cancel' })).toBe('cancelled');
    expect(transitionRun('running', { type: 'fail' })).toBe('failed');
    expect(transitionRun('waiting', { type: 'fail' })).toBe('failed');
    expect(transitionRun('running', { type: 'finish', outcome: 'success' })).toBe('succeeded');
    expect(transitionRun('running', { type: 'finish', outcome: 'failure' })).toBe('failed');
    expect(transitionRun('running', { type: 'finish', outcome: 'exhausted' })).toBe('exhausted');
    expect(transitionRun('running', { type: 'recover' })).toBe('running');
  });

  it('rejects everything else', () => {
    const actions: RunAction[] = [
      { type: 'start' },
      { type: 'park' },
      { type: 'wake' },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'cancel' },
      { type: 'fail' },
      { type: 'finish', outcome: 'success' },
      { type: 'recover' },
    ];
    let rejected = 0;
    for (const status of ALL) {
      for (const action of actions) {
        try {
          transitionRun(status, action);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidTransitionError);
          rejected += 1;
        }
      }
    }
    // 8 statuses x 9 actions = 72 combinations, 15 of which are valid.
    expect(rejected).toBe(72 - 15);
  });
});

describe('status predicates', () => {
  it('classifies statuses', () => {
    expect(ALL.filter(isTerminal)).toEqual(['succeeded', 'failed', 'cancelled', 'exhausted']);
    expect(ALL.filter(isActive)).toEqual(['running', 'waiting', 'paused']);
    expect(outcomeStatus('success')).toBe('succeeded');
    expect(outcomeStatus('failure')).toBe('failed');
    expect(outcomeStatus('exhausted')).toBe('exhausted');
  });
});
