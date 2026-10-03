import type { HandlerRegistry } from '../handler.js';
import { decisionHandler } from './decision.js';
import { exitHandler } from './exit.js';
import { heartbeatHandler } from './heartbeat.js';
import { inferenceHandler } from './inference.js';
import { mutateHandler } from './mutate.js';
import { scriptHandler } from './script.js';
import { subloopHandler } from './subloop.js';
import { triggerHandler } from './trigger.js';
import { waitHandler } from './wait.js';

export function defaultHandlers(): HandlerRegistry {
  return {
    trigger: triggerHandler,
    decision: decisionHandler,
    inference: inferenceHandler,
    script: scriptHandler,
    mutate: mutateHandler,
    subloop: subloopHandler,
    wait: waitHandler,
    heartbeat: heartbeatHandler,
    exit: exitHandler,
  };
}

export {
  triggerHandler,
  decisionHandler,
  inferenceHandler,
  scriptHandler,
  mutateHandler,
  subloopHandler,
  waitHandler,
  heartbeatHandler,
  exitHandler,
};
