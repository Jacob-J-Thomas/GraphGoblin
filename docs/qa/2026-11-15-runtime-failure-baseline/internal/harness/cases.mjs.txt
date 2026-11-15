import assert from 'node:assert/strict';

const diagnosticRoot = 'Q:/synthetic-graphgoblin-qa-381';
const authorPath = 'R:/author-data-qa-381/keep-this-value.txt';
const hold = { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'fixture barrier' } };
export const localScript = ['-e', 'process.stderr.write("QA-381 native stderr"); process.exitCode = 7;'];

function issue(tag) {
  const messageCanary = diagnosticRoot + '/' + tag + '-private-message.ts';
  const stackCanary = diagnosticRoot + '/' + tag + '-private-stack.ts';
  const error = new Error('QA failure at ' + messageCanary);
  error.stack = 'Error: ' + error.message + '\n    at qaFault (' + stackCanary + ':13:7)';
  return { error, messageCanary, stackCanary };
}

function stringify(value) {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Error ? { ...item, name: item.name, message: item.message, stack: item.stack } : item);
}

function deferred() {
  const { promise, resolve } = Promise.withResolvers();
  return { promise, resolve };
}

function coerce(h) {
  return h.runtime.testing.singleNodeLoop('QA 381 repair boundary', {
    id: 'mut', kind: 'mutate', label: 'Controlled repair',
    config: {
      operations: [
        { op: 'set', path: '/vars/raw', value: { kind: 'literal', value: { ok: 'invalid' } } },
        {
          op: 'coerce', source: '/vars/raw', target: '/vars/repaired',
          jsonSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
          repair: { maxAttempts: 1 },
        },
      ],
    },
  });
}

function subloop(h, name, childLoopId, output) {
  return h.runtime.testing.singleNodeLoop(name, {
    id: 'child', kind: 'subloop', label: 'Await child',
    config: { loopRef: { loopId: childLoopId }, ...(output ? { output } : {}) },
  });
}

async function execute(h, definition, overrides) {
  const manager = await h.startManager(overrides);
  const id = await h.start(await h.publish(definition));
  await h.idle();
  return { manager, id, observed: await h.snapshot('terminal', id) };
}

function failed(observed, code, resumable, nodeId) {
  const { snapshot, raw, events } = observed;
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.failure.code, code);
  assert.equal(snapshot.failure.resumable, resumable);
  if (nodeId !== undefined) assert.equal(snapshot.failure.nodeId, nodeId);
  assert.ok(raw.run.finalized_at);
  assert.deepEqual(JSON.parse(raw.run.failure), snapshot.failure);
  const terminal = events.filter((event) => ['run.failed', 'run.finished', 'run.cancelled'].includes(event.type));
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].type, 'run.failed');
  assert.equal(snapshot.lastEventSeq, terminal[0].seq);
  assert.deepEqual(terminal[0].failure, snapshot.failure);
  const rawTerminal = raw.events.filter((event) => event.type === 'run.failed');
  assert.equal(rawTerminal.length, 1);
  assert.deepEqual(JSON.parse(rawTerminal[0].payload).failure, snapshot.failure);
  return snapshot.failure;
}

function nodeDidNotCommit(observed, nodeId) {
  const { events } = observed;
  assert.ok(events.some((event) => event.type === 'node.started' && event.nodeId === nodeId));
  assert.ok(!events.some((event) => event.type === 'node.finished' && event.nodeId === nodeId));
  assert.ok(!events.some((event) => event.type === 'node.started' && event.nodeId === 'done'));
}

function publicDiagnostic(observed, fault, exposeMessage, exposeStack) {
  const failure = observed.snapshot.failure;
  const details = stringify(failure.details ?? null);
  const raw = stringify([observed.raw.run.failure, observed.raw.events.filter((event) =>
    event.type === 'run.failed').map((event) => event.payload)]);
  for (const [canary, exposed] of [
    [fault.messageCanary, exposeMessage],
    [fault.stackCanary, exposeStack],
  ]) {
    assert.equal((failure.message + details).includes(canary), exposed, 'projected diagnostic: ' + canary);
    assert.equal(raw.includes(canary), exposed, 'durable diagnostic: ' + canary);
  }
}

function privateDiagnostic(h, fault, ...identity) {
  for (const canary of [fault.messageCanary, fault.stackCanary]) {
    assert.ok(h.fake.logger.lines.some((entry) => {
      if (!['error', 'warn'].includes(entry.level)) return false;
      const line = stringify(entry);
      return line.includes(canary) && identity.every((part) => line.includes(part));
    }), 'missing correlated private diagnostic for ' + canary + ' ' + identity.join(' '));
  }
}

function operationArray(failure, operations, phase) {
  assert.deepEqual(failure.details.recording.map((entry) => entry.operation), operations);
  for (const entry of failure.details.recording) {
    if (phase === 'candidate') assert.deepEqual(Object.keys(entry), ['operation']);
    else for (const field of ['message', 'name', 'stack']) assert.equal(typeof entry[field], 'string');
  }
}

async function unexpectedRepair(h) {
  const fault = issue('repair');
  let calls = 0;
  const { manager, id, observed } = await execute(h, coerce(h), {
    structured: { complete: async () => { calls += 1; throw fault.error; } },
  });
  assert.equal(calls, 1);
  failed(observed, 'INTERNAL_ERROR', true, 'mut');
  nodeDidNotCommit(observed, 'mut');
  assert.deepEqual((await manager.getThread(id)).vars, {});
  const baseline = h.phase === 'baseline';
  publicDiagnostic(observed, fault, baseline, baseline);
  privateDiagnostic(h, fault, id, 'mut');
}

async function invalidFinalThread(h) {
  const definition = h.runtime.testing.singleNodeLoop('QA 381 final thread validation', {
    id: 'mut', kind: 'mutate', label: 'Invalid final thread',
    config: { operations: [{ op: 'set', path: '/vars', value: { kind: 'literal', value: 7 } }] },
  });
  const { id, manager, observed } = await execute(h, definition);
  const failure = failed(observed, 'INTERNAL_ERROR', false, 'mut');
  nodeDidNotCommit(observed, 'mut');
  assert.deepEqual((await manager.getThread(id)).vars, {});
  assert.equal(observed.snapshot.recovery.resume.code, 'FAILURE_NOT_RESUMABLE');
  assert.doesNotMatch(stringify(failure), /"operation(?:Index|Id)?"\s*:|"stack"\s*:|\/dist\/.*\.js/);
}

async function outerRepository(h) {
  const fault = issue('outer');
  let hits = 0;
  const { id, observed } = await execute(h,
    h.runtime.testing.singleNodeLoop('QA 381 outer transition', hold), {
      runs: h.delegate(h.runs, {
        transition(runId, states, change, ...rest) {
          if (change.status === 'running' && states.includes('queued') && hits === 0) {
            hits += 1;
            return Promise.reject(fault.error);
          }
          return h.runs.transition(runId, states, change, ...rest);
        },
      }),
    });
  assert.equal(hits, 1);
  failed(observed, 'INTERNAL_ERROR', true);
  assert.equal(observed.events[0].type, 'run.queued');
  assert.ok(!observed.events.some((event) => event.type === 'node.started'));
  publicDiagnostic(observed, fault, h.phase === 'baseline', false);
  if (h.phase === 'candidate') privateDiagnostic(h, fault, id);
  else assert.ok(stringify(h.fake.logger.lines).includes(fault.messageCanary));
}

async function pendingRepair(h, mode) {
  const entered = deferred();
  const result = deferred();
  const late = deferred();
  const definition = coerce(h);
  if (mode === 'run-deadline') definition.settings = { runDeadlineSeconds: 60 };
  if (mode === 'repair-deadline') definition.settings = { structuredTimeoutMs: 1500 };
  const logger = h.delegate(h.fake.logger, {
    warn(obj, msg) {
      h.fake.logger.warn(obj, msg);
      if (msg === 'late structured completion discarded') late.resolve(obj);
    },
  });
  const manager = await h.startManager({
    logger,
    structured: {
      complete(_request, signal) {
        entered.resolve(signal);
        return result.promise;
      },
    },
  });
  try {
    const id = await h.start(await h.publish(definition));
    const signal = await h.bounded('structured call entry', entered.promise);
    assert.equal(signal.aborted, false);
    const abort = deferred();
    signal.addEventListener('abort', () => abort.resolve(signal.reason), { once: true });
    if (mode === 'cancel') await manager.cancel(id, h.owner);
    if (mode === 'run-deadline') {
      const timer = h.fake.timers.scheduled.find((entry) => entry.runId === id && entry.key === 'run-deadline');
      assert.ok(timer);
      assert.equal(timer.at.getTime() - h.fake.clock.now().getTime(), 60_000);
      h.fake.clock.advance(60_000);
      assert.equal(await h.fake.timers.fireDue(h.fake.clock.now()), 1);
    }
    const reason = await h.bounded('forwarded structured abort', abort.promise);
    await h.idle();
    const before = await h.snapshot('beforeLate', id);
    nodeDidNotCommit(before, 'mut');
    if (mode === 'cancel') {
      assert.equal(before.snapshot.status, 'cancelled');
      assert.equal(before.snapshot.failure, undefined);
      assert.ok(before.raw.run.finalized_at);
      assert.equal(before.events.filter((event) => event.type === 'run.cancel_requested').length, 1);
      assert.deepEqual(before.events.filter((event) =>
        ['run.cancelled', 'run.failed', 'run.finished'].includes(event.type)).map((event) => event.type),
      ['run.cancelled']);
    } else if (mode === 'run-deadline') {
      assert.equal(reason.code, 'RUN_DEADLINE_EXCEEDED');
      failed(before, 'RUN_DEADLINE_EXCEEDED', false, 'mut');
      assert.equal(before.snapshot.recovery.resume.code, 'FAILURE_NOT_RESUMABLE');
    } else {
      assert.equal(reason.code, 'STRUCTURED_COMPLETION_TIMEOUT');
      const failure = failed(before, 'STRUCTURED_COMPLETION_TIMEOUT', true, 'mut');
      assert.equal(failure.details.timeoutMs, 1500);
      assert.equal(failure.details.provenance.provider, 'codex');
    }
    result.resolve({ value: { ok: true } });
    const diagnostic = await h.bounded('late structured callback discarded', late.promise);
    assert.equal(diagnostic.runId, id);
    assert.equal(diagnostic.nodeId, 'mut');
    await h.setImmediate();
    const after = await h.snapshot('afterLate', id);
    assert.deepEqual(after, before);
    assert.deepEqual((await manager.getThread(id)).vars, {});
  } finally {
    result.resolve({ value: { ok: true } });
  }
}

function scriptDefinition(h) {
  return h.runtime.testing.singleNodeLoop('QA 381 native script', {
    id: 'script', kind: 'script', label: 'Exit on purpose',
    config: { command: process.execPath, args: localScript, cwd: 'workspace', timeoutSeconds: 3 },
  });
}

async function script(h, recordingFault) {
  const fault = issue('script-progress');
  let hits = 0;
  const { id, observed } = await execute(h, scriptDefinition(h), recordingFault ? {
    events: h.delegate(h.events, {
      async append(runId, drafts, options) {
        const result = await h.events.append(runId, drafts, options);
        if (drafts.some((draft) => draft.type === 'node.progress' && draft.nodeId === 'script')) {
          hits += 1;
          throw fault.error;
        }
        return result;
      },
    }),
  } : {});
  assert.equal(hits, recordingFault ? 1 : 0);
  assert.equal(h.report.processLog.length, 1);
  const child = h.report.processLog[0];
  assert.ok(child.pid);
  assert.deepEqual(child.exit, { code: 7, signal: null });
  assert.deepEqual(child.close, child.exit);
  const dispatch = observed.events.find((event) => event.type === 'script.dispatched');
  const progress = observed.events.find((event) => event.type === 'node.progress' && event.nodeId === 'script');
  assert.ok(dispatch && progress && dispatch.seq < progress.seq);
  assert.equal(progress.progress.exitCode, 7);
  assert.equal(progress.progress.stderr, 'QA-381 native stderr');
  const failure = failed(observed, recordingFault ? 'SCRIPT_OUTCOME_UNCERTAIN' : 'SCRIPT_EXIT_CODE', true, 'script');
  nodeDidNotCommit(observed, 'script');
  assert.equal(failure.script.visitId, dispatch.visitId);
  assert.equal(failure.script.dispatchId, dispatch.dispatchId);
  if (recordingFault) {
    assert.equal(failure.script.state, 'outcome-uncertain');
    assert.equal(observed.snapshot.recovery.resume.code, 'SCRIPT_CONSENT_REQUIRED');
    publicDiagnostic(observed, fault, false, false);
    privateDiagnostic(h, fault, id, 'script');
  } else {
    assert.equal(failure.script.state, 'completed');
    assert.equal(failure.script.exitCode, 7);
    assert.equal(failure.details.stderr, 'QA-381 native stderr');
    assert.equal(observed.snapshot.recovery.resume.allowed, true);
  }
}

async function typedInference(h) {
  const primary = issue('inference-intent');
  const reconcile = issue('inference-reconcile');
  const status = issue('inference-status');
  const fakeHarness = new h.runtime.testing.FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }]);
  let appendFailed = false;
  let readFailed = false;
  let statusFailed = false;
  const { id, observed, manager } = await execute(h, h.runtime.testing.failureLoop('codex'), {
    harnesses: { codex: fakeHarness },
    events: h.delegate(h.events, {
      async append(runId, drafts, options) {
        const result = await h.events.append(runId, drafts, options);
        if (!appendFailed && drafts.some((draft) => draft.type === 'harness.turn' && draft.promptKind === 'repair')) {
          appendFailed = true;
          throw primary.error;
        }
        return result;
      },
      read(...args) {
        if (appendFailed && !readFailed) {
          readFailed = true;
          return Promise.reject(reconcile.error);
        }
        return h.events.read(...args);
      },
    }),
    sessions: h.delegate(h.sessions, {
      async upsert(row) {
        await h.sessions.upsert(row);
        if (row.status === 'failed' && !statusFailed) {
          statusFailed = true;
          throw status.error;
        }
      },
    }),
  });
  assert.ok(appendFailed && readFailed && statusFailed);
  const failure = failed(observed, 'INTERNAL_ERROR', true, 'infer');
  assert.equal(failure.inference.promptKind, 'repair');
  assert.equal(failure.inference.submission, 'definitely-not-submitted');
  assert.equal(failure.inference.retry.prompt, 'Repair exactly: "invalid"');
  assert.equal(failure.inference.retry.harness, 'codex');
  const repairTurn = observed.events.find((event) => event.type === 'harness.turn' && event.promptKind === 'repair');
  assert.equal(repairTurn.turnId, failure.inference.turnId);
  assert.ok(observed.events.some((event) => event.type === 'harness.submission' &&
    event.turnId === repairTurn.turnId && event.submission === 'definitely-not-submitted'));
  assert.equal(observed.sessions.at(-1).status, 'failed');
  operationArray(failure, ['turn.intent.reconcile', 'harness.status'], h.phase);
  const baseline = h.phase === 'baseline';
  for (const fault of [primary, reconcile, status]) publicDiagnostic(observed, fault, baseline, baseline);
  assert.equal(fakeHarness.started.length, 1);
  assert.equal(fakeHarness.resumed.length, 0);
  assert.equal(observed.snapshot.recovery.resume.allowed, true);
  if (!baseline) {
    privateDiagnostic(h, primary, id, 'infer');
    privateDiagnostic(h, reconcile, id, 'infer', repairTurn.turnId, 'turn.intent.reconcile');
    privateDiagnostic(h, status, id, 'infer', repairTurn.turnId, 'harness.status');
  }
  await manager.resume(id, h.owner, { observedSeq: observed.snapshot.recovery.observedSeq });
  await h.idle();
  const resumed = await h.snapshot('resumed', id);
  assert.equal(resumed.snapshot.status, 'succeeded');
  assert.equal(fakeHarness.resumed.length, 1);
  assert.equal(fakeHarness.resumed[0].request.turn.prompt, 'Repair exactly: "invalid"');
  assert.equal(new Set(resumed.events.filter((event) => event.type === 'harness.turn' &&
    event.promptKind === 'repair').map((event) => event.turnId)).size, 1);
}

async function providerInference(h) {
  const submission = issue('provider-submission');
  const status = issue('provider-status');
  const spec = h.runtime.testing.failureCases.find((item) =>
    item.code === 'HARNESS_TRANSPORT_FAILED' && item.state === 'definitely-not-submitted');
  assert.ok(spec);
  const controlled = h.runtime.testing.failureHarness('codex', spec, 'launch', true);
  let submissionFailed = false;
  let statusFailed = false;
  const { id, observed, manager } = await execute(h, h.runtime.testing.failureLoop('codex'), {
    harnesses: { codex: controlled.port },
    events: h.delegate(h.events, {
      async append(runId, drafts, options) {
        const result = await h.events.append(runId, drafts, options);
        if (!submissionFailed && controlled.calls.length === 2 && drafts.some((item) =>
          item.type === 'harness.submission' && item.submission === 'definitely-not-submitted')) {
          submissionFailed = true;
          throw submission.error;
        }
        return result;
      },
    }),
    sessions: h.delegate(h.sessions, {
      async upsert(row) {
        await h.sessions.upsert(row);
        if (row.status === 'failed' && !statusFailed) {
          statusFailed = true;
          throw status.error;
        }
      },
    }),
  });
  assert.ok(submissionFailed && statusFailed);
  assert.equal(controlled.calls.length, 2);
  const failure = failed(observed, 'HARNESS_TRANSPORT_FAILED', true, 'infer');
  assert.equal(failure.inference.promptKind, 'repair');
  assert.equal(failure.inference.submission, 'definitely-not-submitted');
  assert.equal(observed.snapshot.recovery.resume.allowed, true);
  const repairTurn = observed.events.find((event) => event.type === 'harness.turn' && event.promptKind === 'repair');
  const recordedSubmission = observed.events.find((event) => event.type === 'harness.submission' &&
    event.turnId === repairTurn.turnId && event.submission === 'definitely-not-submitted');
  const terminal = observed.events.find((event) => event.type === 'run.failed');
  assert.ok(repairTurn.seq < recordedSubmission.seq && recordedSubmission.seq < terminal.seq);
  assert.equal(failure.inference.turnId, repairTurn.turnId);
  operationArray(failure, ['harness.submission', 'harness.status'], h.phase);
  const baseline = h.phase === 'baseline';
  for (const fault of [submission, status]) publicDiagnostic(observed, fault, baseline, baseline);
  if (!baseline) {
    privateDiagnostic(h, submission, id, 'infer', repairTurn.turnId, 'harness.submission');
    privateDiagnostic(h, status, id, 'infer', repairTurn.turnId, 'harness.status');
  }
  await manager.resume(id, h.owner, { observedSeq: observed.snapshot.recovery.observedSeq });
  await h.idle();
  const resumed = await h.snapshot('resumed', id);
  assert.equal(resumed.snapshot.status, 'succeeded');
  assert.equal(controlled.calls.length, 3);
  assert.equal(controlled.calls.at(-1), 'Repair exactly: "invalid"');
}

async function mapping(h) {
  await h.startManager();
  const child = await h.publish(h.runtime.testing.singleNodeLoop('QA 381 successful child', {
    id: 'work', kind: 'mutate', label: 'Work',
    config: { operations: [{ op: 'set', path: '/vars/ok', value: { kind: 'literal', value: true } }] },
  }));
  const id = await h.start(await h.publish(subloop(h, 'QA 381 output mapping', child, {
    mode: 'custom', custom: { patch: '$error("qa-381-output-mapping")' },
  })));
  await h.idle();
  const observed = await h.snapshot('parent', id);
  const failure = failed(observed, 'INTERNAL_ERROR', true, 'child');
  const childId = observed.events.find((event) => event.type === 'child_run.started').childRunId;
  assert.equal((await h.snapshot('child', childId)).snapshot.status, 'succeeded');
  const completion = observed.events.filter((event) => event.type === 'child_run.finished');
  assert.equal(completion.length, 1);
  assert.equal(completion[0].childRunId, childId);
  assert.equal(completion[0].seq + 1, observed.events.find((event) => event.type === 'run.failed').seq);
  nodeDidNotCommit(observed, 'child');
  if (h.phase === 'baseline') assert.ok(failure.details.stack.includes(' at '));
  else assert.doesNotMatch(stringify(failure), /"stack"\s*:|\/dist\/.*\.js/);
  assert.ok(h.fake.logger.lines.some((line) => {
    const logged = stringify(line);
    return logged.includes(id) && logged.includes('qa-381-output-mapping') && logged.includes(' at ');
  }));
}

async function seedTerminal(h, id, failure) {
  // Synthetic old-build payload through supported storage contracts, with no SQL mutation.
  const run = await h.runs.get(id);
  assert.equal(run.status, 'waiting');
  await h.events.append(id, [{ type: 'run.failed', failure }]);
  const failedRow = await h.runs.transition(id, ['waiting'], {
    status: 'failed', failure, waiting: undefined, finishedAt: h.fake.clock.now().toISOString(),
  });
  assert.equal(failedRow.status, 'failed');
  await h.runs.markFinalized(id);
  return h.raw(id);
}

function childLink(observed, childId, nodeId) {
  const details = observed.snapshot.failure.details;
  assert.equal(details.childRunId, childId);
  assert.equal(details.childNodeId, nodeId);
  const completion = observed.events.find((event) => event.type === 'child_run.finished');
  assert.equal(completion.childRunId, childId);
  assert.equal(completion.seq + 1, observed.events.find((event) => event.type === 'run.failed').seq);
}

async function historical(h, typed) {
  const fault = issue(typed ? 'old-secondary' : 'old-primary');
  const code = typed ? 'HARNESS_TRANSPORT_FAILED' : 'INTERNAL_ERROR';
  const childFailure = typed ? {
    code, message: 'Historical public provider failure ' + authorPath, resumable: true, nodeId: 'hold',
    details: {
      providerDetail: { path: authorPath },
      recording: [{ operation: 'harness.status', message: fault.error.message, name: 'Error', stack: fault.error.stack }],
    },
  } : {
    code, message: fault.error.message, resumable: true, nodeId: 'hold',
    details: { name: 'Error', stack: fault.error.stack },
  };
  await h.startManager();
  const leaf = await h.publish(h.runtime.testing.singleNodeLoop('QA 381 legacy leaf', hold));
  const middle = await h.publish(subloop(h, 'QA 381 legacy middle', leaf));
  const rootId = await h.start(await h.publish(subloop(h, 'QA 381 legacy root', middle)));
  await h.idle();
  const rootPark = await h.snapshot('rootPark', rootId);
  assert.equal(rootPark.snapshot.status, 'waiting');
  assert.equal(rootPark.snapshot.waiting.kind, 'child');
  const middleId = rootPark.snapshot.waiting.childRunId;
  const middlePark = await h.snapshot('middlePark', middleId);
  assert.equal(middlePark.snapshot.status, 'waiting');
  assert.equal(middlePark.snapshot.waiting.kind, 'child');
  const leafId = middlePark.snapshot.waiting.childRunId;
  const leafPark = await h.snapshot('leafPark', leafId);
  assert.equal(leafPark.snapshot.status, 'waiting');
  assert.equal(leafPark.snapshot.waiting.kind, 'input');
  await h.stopManager();
  const leafBefore = await seedTerminal(h, leafId, childFailure);
  h.report.observations.legacyLeafBefore = leafBefore;
  let middleBefore;
  if (typed) {
    // Existing canonical child wrapper containing a legacy leaf's secondary diagnostics.
    middleBefore = await seedTerminal(h, middleId, {
      code, message: 'subloop child ' + leafId + ' failed: ' + childFailure.message,
      nodeId: 'child', resumable: true,
      details: { childRunId: leafId, childNodeId: 'hold', childDetails: childFailure.details },
    });
    h.report.observations.legacyMiddleBefore = middleBefore;
  }
  await h.startManager();
  await h.idle();
  const root = await h.snapshot('rootTerminal', rootId);
  const middleResult = await h.snapshot('middleTerminal', middleId);
  const leafResult = await h.snapshot('leafTerminal', leafId);
  assert.deepEqual(leafResult.raw, leafBefore);
  if (typed) assert.deepEqual(middleResult.raw, middleBefore);
  failed(root, code, true, 'child');
  childLink(root, middleId, 'child');
  const baseline = h.phase === 'baseline';
  publicDiagnostic(root, fault, baseline, baseline);
  if (typed) {
    const nested = root.snapshot.failure.details.childDetails;
    assert.equal(nested.childRunId, leafId);
    assert.equal(nested.childNodeId, 'hold');
    assert.deepEqual(nested.childDetails.providerDetail, { path: authorPath });
    assert.match(root.snapshot.failure.message, /keep-this-value\.txt/);
    operationArray({ details: nested.childDetails }, ['harness.status'], h.phase);
    if (!baseline) privateDiagnostic(h, fault, rootId, middleId);
  } else {
    failed(middleResult, code, true, 'child');
    childLink(middleResult, leafId, 'hold');
    publicDiagnostic(middleResult, fault, baseline, baseline);
    if (!baseline) privateDiagnostic(h, fault, middleId, leafId);
  }
}

export const cases = {
  'unexpected-repair': unexpectedRepair,
  'invalid-final-thread': invalidFinalThread,
  'outer-repository': outerRepository,
  'late-result-after-cancel': (h) => pendingRepair(h, 'cancel'),
  'late-result-after-run-deadline': (h) => pendingRepair(h, 'run-deadline'),
  'late-result-after-repair-deadline': (h) => pendingRepair(h, 'repair-deadline'),
  'local-nonzero-script': (h) => script(h, false),
  'script-dispatch-precedence': (h) => script(h, true),
  'typed-inference-internal': typedInference,
  'typed-inference-provider': providerInference,
  'typed-subloop-mapping': mapping,
  'historical-child-primary': (h) => historical(h, false),
  'historical-nested-recording': (h) => historical(h, true),
};
