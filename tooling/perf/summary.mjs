/* global process */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import { root } from './common.mjs';

const pick = (value, keys) =>
  Object.fromEntries(keys.filter((k) => value?.[k] !== undefined).map((k) => [k, value[k]]));
const row = (value, columns) => columns.map((k) => value?.[k] ?? null);
const mainPorts = new Set([
  'events.append',
  'events.read',
  'runs.get',
  'runs.update',
  'runs.saveThread',
  'runs.transition',
  'artifacts.put',
  'sessions.upsert',
]);
const portColumns = ['method', 'count', 'totalMs', 'meanMs', 'p95UpperMs', 'maxMs'];
const specificationColumns = [
  'passes',
  'items',
  'itemBytes',
  'contextBytes',
  'inference',
  'grow',
  'artifacts',
  'delayMs',
];
const correctnessColumns = [
  'ok',
  'succeeded',
  'nodeCountsOk',
  'unexpectedAttempts',
  'storedEvents',
  'progress',
  'expectedProgress',
  'gates',
  'passes',
  'history',
  'historyValuesOk',
  'terminal',
  'replayOk',
  'browserOk',
];
const checkpointColumns = [
  'pass',
  'elapsedMs',
  'snapshotBytes',
  'getThreadMs',
  'snapshotSerializeMs',
  'heapUsed',
];
const browserColumns = [
  'elapsedMs',
  'nodes',
  'sessionStorageBytes',
  'heapUsed',
  'longTasks',
  'longTaskMs',
];
const flightColumns = [
  'replayElapsedMs',
  'socketBytesWritten',
  'wireBytesConsumed',
  'bytesInFlight',
];
function frames(profile) {
  return (profile?.top ?? []).slice(0, 3).map(([location, samples]) => {
    let relative = location.replace(pathToFileURL(root).href, '').replaceAll('\\', '/');
    if (/file:|[a-z]:\//i.test(relative) || relative.startsWith('/'))
      relative = 'external/' + basename(relative);
    return [relative, samples];
  });
}
function curve(points, limit = 10) {
  if (points.length <= limit) return points;
  return Array.from(
    { length: limit },
    (_, i) => points[Math.round((i * (points.length - 1)) / (limit - 1))],
  );
}
function replay(value) {
  const post = value.afterMemory ?? {};
  return {
    ...pick(value, [
      'after',
      'pauseMs',
      'initialPauseMs',
      'reader',
      'events',
      'lastSeq',
      'gaps',
      'sha256',
      'firstMs',
      'totalMs',
      'reads',
      'receivedBytes',
      'wireBytesConsumed',
      'socketBytesWritten',
      'maxBytesInFlight',
      'eventLoopDelayMs',
    ]),
    sampleScope: value.eventLoopDelayMs
      ? 'replay interval'
      : 'round-1 post-replay samples; lag buffering unmeasured',
    heapUsedBefore: value.before?.heapUsed,
    heapUsedSampledMax: post.maxHeap,
    writableBytesSampledMax: post.maxWritableBytes,
    flightSamples: curve(value.observations ?? []).map((p) => row(p, flightColumns)),
    readMs: post.repositoryTimings?.['events.read']?.totalMs,
  };
}
function browser(value) {
  return {
    ...pick(value, ['browser', 'channel', 'headless', 'warmup', 'inbound']),
    pages: (value.pages ?? []).map((p) => {
      const metrics = p.metrics ?? [];
      const tasks = metrics.at(-1)?.entries ?? [];
      return {
        ...pick(p, [
          'name',
          'durationMs',
          'historyReadyMs',
          'firstRowsMs',
          'historyTargetSeq',
          'historyReadyCount',
          'executionContinued',
          'runningThroughout',
        ]),
        shellReadyMs: p.shellReadyMs ?? p.ttiMs,
        historyReadyMs: p.historyReadyMs ?? null,
        pageErrorCount: p.errors?.length ?? 0,
        serverSeqBefore: p.beforeRun?.lastEventSeq,
        serverSeqAfter: p.afterRun?.lastEventSeq,
        longTasks: tasks.length,
        longTaskMs: tasks.reduce((n, t) => n + t.duration, 0),
        peakHeapUsed: Math.max(0, ...metrics.map((m) => m.cdp?.JSHeapUsedSize ?? 0)),
        peakNodes: Math.max(0, ...metrics.map((m) => m.nodes)),
        peakSessionStorageBytes: Math.max(0, ...metrics.map((m) => m.sessionStorageBytes)),
        // First five seconds retain loading; always retain the final sample as well.
        samples: [...metrics.filter((m) => m.elapsedMs <= 5000), ...metrics.slice(-1)].map((m) =>
          row(
            {
              ...m,
              heapUsed: m.cdp?.JSHeapUsedSize,
              longTasks: m.entries?.length,
              longTaskMs: m.entries?.reduce((n, t) => n + t.duration, 0),
            },
            browserColumns,
          ),
        ),
        cdp: pick(metrics.at(-1)?.cdp, [
          'ScriptDuration',
          'TaskDuration',
          'LayoutDuration',
          'RecalcStyleDuration',
        ]),
      };
    }),
  };
}
function measurement(r) {
  return {
    workload: r.workload,
    aged: r.aged,
    instrumentationRevision: r.schema,
    cpuProfileSamples: r.cpuProfile?.samples,
    environment: pick(r.environment, [
      'timestamp',
      'cpu',
      'logicalCpus',
      'ramBytes',
      'node',
      'profileMode',
      'platform',
      'osRelease',
      'commit',
      'hostBusyFraction',
      'freeRamBefore',
      'freeRamAfter',
    ]),
    failed: !!(
      r.error ||
      r.closeError ||
      r.profileError ||
      r.memoryLogError ||
      r.correctnessFailure
    ),
    population: r.population,
    cases: r.cases.map((c) =>
      c.cli
        ? {
            preflight: {
              wallMs: c.cli.wallMs,
              exitCode: c.cli.exitCode,
              databaseReady: /ok\s+Database\s+reachable and migrated/.test(c.cli.stdout ?? ''),
            },
            cold: {
              entryPoint: c.cold?.entryPoint ?? 'tooling/perf/worker.mjs (round 1)',
              ...pick(c.cold, [
                'startupToListeningMs',
                'firstRequestMs',
                'startupToFirstResponseMs',
                'pollMs',
                'polls',
                'exitCode',
                'signal',
              ]),
            },
            warm: { bootMs: c.reopened?.bootMs, firstRequestMs: c.firstRequestMs },
          }
        : {
            ...pick(c, [
              'specification',
              'wallMs',
              'msPerPass',
              'cpu',
              'durableAdmissionToStartMs',
              'awaitedPortMs',
              'observationMs',
              'residualMs',
              'maxConcurrentPortCalls',
              'eventLoopDelayMs',
              'threadRequest',
              'artifacts',
              'storageBefore',
              'storageAfter',
            ]),
            portTimings: Object.entries(c.timings)
              .filter(([method]) => mainPorts.has(method))
              .map(([method, t]) => row({ method, ...t }, portColumns)),
            otherPorts: Object.entries(c.timings)
              .filter(([method]) => !mainPorts.has(method))
              .reduce(
                (sum, [_method, t]) => ({
                  calls: sum.calls + t.count,
                  totalMs: sum.totalMs + t.totalMs,
                }),
                { calls: 0, totalMs: 0 },
              ),
            checkpoints: curve(c.checkpoints, 6).map((p) => row(p, checkpointColumns)),
            correctness: pick(c.correctness, [
              'ok',
              'succeeded',
              'nodeCountsOk',
              'unexpectedAttempts',
              'storedEvents',
              'progress',
              'expectedProgress',
              'gates',
              'passes',
              'visits',
              'history',
              'historyValuesOk',
              'terminal',
              'replayOk',
              'browserOk',
            ]),
            posthocVerified: c.posthocValidation?.ok,
            eventSerialization: pick(c.eventSerialization, [
              'totalMs',
              'bytes',
              'sha256',
              'lateAfter',
              'lateSha256',
            ]),
            cpuSamples: c.cpuSamples?.count,
            topCpuFrames: frames(c.cpuSamples),
            ...(c.replays
              ? {
                  replays: {
                    first: replay(c.replays.first),
                    late: replay(c.replays.late),
                    slow: replay(c.replays.slow),
                    reconnect: {
                      ok: c.replays.reconnect.ok,
                      interrupted: replay(c.replays.reconnect.interrupted),
                      reconnected: replay(c.replays.reconnect.reconnected),
                    },
                  },
                }
              : {}),
            ...(c.browser ? { browser: browser(c.browser) } : {}),
          },
    ),
  };
}
export function summarize(records) {
  const measurements = records.map(measurement),
    ports = [],
    cpuLocations = [];
  const intern = (dictionary, value) => {
    let index = dictionary.indexOf(value);
    if (index < 0) {
      index = dictionary.length;
      dictionary.push(value);
    }
    return index;
  };
  for (const r of measurements)
    for (const c of r.cases) {
      for (const timing of c.portTimings ?? []) timing[0] = intern(ports, timing[0]);
      for (const frame of c.topCpuFrames ?? []) frame[0] = intern(cpuLocations, frame[0]);
      if (c.storageBefore && c.storageAfter) {
        c.storeGrowthBytes = c.storageAfter.bytes - c.storageBefore.bytes;
        delete c.storageBefore;
        delete c.storageAfter;
      }
    }
  const cases = [],
    browserPages = [],
    replayRecords = [];
  const append = (list, value) => {
    const index = list.length;
    list.push(value);
    return index;
  };
  measurements.forEach((r, measurementIndex) => {
    r.cases = r.cases.map((c) => {
      const caseIndex = cases.length;
      c.measurement = measurementIndex;
      if (c.specification) c.specification = row(c.specification, specificationColumns);
      if (c.correctness) {
        c.nodeVisits = c.correctness.visits;
        c.correctness = row(c.correctness, correctnessColumns);
      }
      if (c.browser)
        c.browser.pages = c.browser.pages.map((page) =>
          append(browserPages, { case: caseIndex, ...page }),
        );
      if (c.replays) {
        for (const name of ['first', 'late', 'slow'])
          c.replays[name] = append(replayRecords, {
            case: caseIndex,
            variant: name,
            ...c.replays[name],
          });
        for (const name of ['interrupted', 'reconnected'])
          c.replays.reconnect[name] = append(replayRecords, {
            case: caseIndex,
            variant: name,
            ...c.replays.reconnect[name],
          });
      }
      return append(cases, c);
    });
  });
  // Shared dictionaries keep repeated method/frame names out of each case.
  return JSON.parse(
    JSON.stringify(
      {
        schema: 2,
        columns: {
          specification: specificationColumns,
          correctness: correctnessColumns,
          portTimings: ['portIndex', ...portColumns.slice(1)],
          checkpoints: checkpointColumns,
          browserSamples: browserColumns,
          flightSamples: flightColumns,
          topCpuFrames: ['cpuLocationIndex', 'samples'],
        },
        ports,
        cpuLocations,
        measurements,
        cases,
        browserPages,
        replays: replayRecords,
      },
      (_key, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v),
    ),
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const output = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
  if (!output)
    throw new Error(
      'Usage: node tooling/perf/summary.mjs --out=summary.json raw-summary.json [...]',
    );
  const records = [];
  for (const file of process.argv.slice(2).filter((a) => !a.startsWith('--out='))) {
    const value = JSON.parse(await readFile(file, 'utf8'));
    records.push(...(Array.isArray(value) ? value : [value]));
  }
  await writeFile(output, JSON.stringify(summarize(records), null, 2) + '\n');
}
