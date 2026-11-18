// Disposable independent-QA scenarios for #407 correction 01. Not candidate code; removed after the QA session.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, inject } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { createApiProcessFixture, listening } from '../testing/api-subprocess.js';
import {
  UUID,
  abort,
  alive,
  bindProbe,
  brief,
  hr,
  httpGet,
  logger,
  newest,
  qaEnv,
  signal,
  sleep,
  slotState,
  startForeign,
  tryReserve,
  waitFor,
  writeJson,
} from './qa407c-util.js';

const D2_PORT = 63800;
const D2_MS = 8_000;
const errInfo = (e: unknown) => ({
  code: (e as NodeJS.ErrnoException)?.code,
  message: String((e as Error)?.message ?? e),
});
const settle = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: NodeJS.ErrnoException) => `rejected:${e.code}:${e.message}`,
  );

type Grant = {
  role: string;
  pid: number;
  seq: number;
  gen: number;
  uuid: string;
  tGrant: string;
  tRelCall: string;
  tRelDone: string;
  okAtGrant: boolean;
  okBefore: boolean;
  okAfter: boolean;
  relOk: boolean;
  beforeSeen?: unknown;
  afterEntries?: string[];
};

// ---------------------------------------------------------------- D2 (K4, K8)
export async function runD2(role: 'A' | 'B') {
  const other = role === 'A' ? 'B' : 'A';
  const root = inject('apiPortRoot');
  const slot = join(root, String(D2_PORT));
  const log = logger('D2', role);
  try {
    await log('start', { root, temp: process.env.TEMP });
    await signal(`D2-${role}-ready`, { root });
    const peer = await waitFor(`D2-${other}-ready`, other, 60_000);
    const began = Date.now();
    const until = began + D2_MS;
    const counts = { attempts: 0, grants: 0, exhausted: 0, unexpectedReserve: 0, releaseErrors: 0, harnessFs: 0 };
    const samples = { unexpectedReserve: [] as unknown[], releaseErrors: [] as unknown[], harnessFs: [] as unknown[] };
    const wrongPort: number[] = [];
    const grants: Grant[] = [];
    let maxRefusalNs = 0n;
    let maxGrantNs = 0n;
    while (Date.now() < until) {
      counts.attempts++;
      const a = await tryReserve(D2_PORT, 1);
      const dur = a.t1 - a.t0;
      if (!a.ok) {
        if (a.exhausted) {
          counts.exhausted++;
          if (dur > maxRefusalNs) maxRefusalNs = dur;
        } else {
          counts.unexpectedReserve++;
          if (samples.unexpectedReserve.length < 25)
            samples.unexpectedReserve.push({ t0: String(a.t0), code: a.code, message: a.message });
        }
        continue;
      }
      counts.grants++;
      if (dur > maxGrantNs) maxGrantNs = dur;
      if (a.port !== D2_PORT) wrongPort.push(a.port);
      const g: Grant = {
        role,
        pid: process.pid,
        seq: counts.grants,
        gen: -1,
        uuid: '',
        tGrant: String(a.t1),
        tRelCall: '',
        tRelDone: '',
        okAtGrant: false,
        okBefore: false,
        okAfter: false,
        relOk: false,
      };
      try {
        const s1 = await newest(slot);
        g.gen = s1.latest;
        g.uuid = s1.entries.join('|');
        g.okAtGrant = s1.entries.length === 1 && UUID.test(s1.entries[0] ?? '');
        const s2 = await newest(slot);
        g.okBefore = s2.latest === g.gen && s2.entries.length === 1 && s2.entries[0] === s1.entries[0];
        if (!g.okBefore) g.beforeSeen = s2;
      } catch (e) {
        counts.harnessFs++;
        if (samples.harnessFs.length < 25) samples.harnessFs.push({ phase: 'grant-check', ...errInfo(e) });
      }
      g.tRelCall = String(hr());
      try {
        await a.release();
        g.relOk = true;
      } catch (e) {
        counts.releaseErrors++;
        if (samples.releaseErrors.length < 25) samples.releaseErrors.push({ gen: g.gen, ...errInfo(e) });
      }
      g.tRelDone = String(hr());
      try {
        const after = await readdir(join(slot, String(g.gen)));
        g.okAfter = after.length === 1 && after[0] === 'released';
        if (!g.okAfter) g.afterEntries = after;
      } catch (e) {
        counts.harnessFs++;
        if (samples.harnessFs.length < 25) samples.harnessFs.push({ phase: 'after-check', ...errInfo(e) });
      }
      grants.push(g);
    }
    const ended = Date.now();
    const summary = {
      role,
      pid: process.pid,
      root,
      peerRoot: peer.root,
      peerPid: peer.pid,
      began,
      ended,
      durationMs: ended - began,
      ...counts,
      maxRefusalMs: Number(maxRefusalNs) / 1e6,
      maxGrantMs: Number(maxGrantNs) / 1e6,
      wrongPort,
      ownershipFailures: grants.filter((g) => !(g.okAtGrant && g.okBefore && g.okAfter)).length,
      firstGen: grants[0]?.gen,
      lastGen: grants.at(-1)?.gen,
      samples,
    };
    await writeJson(`D2-grants-${role}.json`, grants);
    await writeJson(`D2-summary-${role}.json`, summary);
    await log('done', summary);
    await signal(`D2-${role}-done`, { grants: counts.grants });
    await waitFor(`D2-${other}-done`, other, 60_000);

    expect.soft(summary.peerRoot, 'both workers share one injected root').toBe(root);
    expect.soft(summary.peerPid, 'peer is a different process').not.toBe(process.pid);
    expect.soft(counts.grants, 'grants').toBeGreaterThan(0);
    expect.soft(counts.exhausted, 'exhaustion refusals (real contention)').toBeGreaterThan(0);
    expect.soft(counts.unexpectedReserve, 'unexpected reservation errors').toBe(0);
    expect.soft(counts.releaseErrors, 'release errors').toBe(0);
    expect.soft(counts.harnessFs, 'harness filesystem errors').toBe(0);
    expect.soft(wrongPort, 'wrong ports').toEqual([]);
    expect.soft(summary.ownershipFailures, 'on-disk ownership failures').toBe(0);
    return summary;
  } catch (e) {
    await abort(role, e);
    throw e;
  }
}

export async function analyzeD2() {
  const { out } = qaEnv();
  const root = inject('apiPortRoot');
  const A = JSON.parse(await readFile(join(out, 'D2-grants-A.json'), 'utf8')) as Grant[];
  const B = JSON.parse(await readFile(join(out, 'D2-grants-B.json'), 'utf8')) as Grant[];
  const all = [...A, ...B];
  const byGen = new Map<number, Grant[]>();
  for (const g of all) byGen.set(g.gen, [...(byGen.get(g.gen) ?? []), g]);
  const dupGens = [...byGen.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ gen: k, roles: v.map((g) => g.role) }));
  const pick = (g: Grant) => ({ role: g.role, gen: g.gen, tGrant: g.tGrant, tRelCall: g.tRelCall });

  const byTime = [...all].sort((x, y) => (BigInt(x.tGrant) < BigInt(y.tGrant) ? -1 : BigInt(x.tGrant) > BigInt(y.tGrant) ? 1 : 0));
  const overlaps: unknown[] = [];
  let handovers = 0;
  let minHandoverNs: bigint | undefined;
  for (let i = 1; i < byTime.length; i++) {
    const prev = byTime[i - 1]!;
    const next = byTime[i]!;
    if (!(BigInt(prev.tRelCall) < BigInt(next.tGrant))) overlaps.push({ prev: pick(prev), next: pick(next) });
    if (prev.role !== next.role) {
      handovers++;
      const gap = BigInt(next.tGrant) - BigInt(prev.tRelCall);
      if (minHandoverNs === undefined || gap < minHandoverNs) minHandoverNs = gap;
    }
  }
  const byGenSorted = [...all].sort((x, y) => x.gen - y.gen);
  const genOrderViolations: unknown[] = [];
  for (let i = 1; i < byGenSorted.length; i++) {
    const prev = byGenSorted[i - 1]!;
    const next = byGenSorted[i]!;
    if (!(BigInt(prev.tRelCall) < BigInt(next.tGrant))) genOrderViolations.push({ prev: pick(prev), next: pick(next) });
  }
  const disk = await slotState(root, D2_PORT);
  const contiguous = disk.gens.every((g, i) => g === i + 1);
  const nonReleased = disk.gens.filter((g) => {
    const e = disk.entries[String(g)] ?? [];
    return !(e.length === 1 && e[0] === 'released');
  });
  const grantGens = new Set(all.map((g) => g.gen));
  const diskGensWithoutGrant = disk.gens.filter((g) => !grantGens.has(g));
  const grantGensMissingOnDisk = [...grantGens].filter((g) => !disk.gens.includes(g));
  const crossedDecimalWidths = [9, 99, 999].filter((w) => grantGens.has(w) && grantGens.has(w + 1));
  const analysis = {
    grantsA: A.length,
    grantsB: B.length,
    total: all.length,
    uniqueGens: byGen.size,
    dupGens,
    overlapsCount: overlaps.length,
    overlaps: overlaps.slice(0, 20),
    genOrderViolationsCount: genOrderViolations.length,
    genOrderViolations: genOrderViolations.slice(0, 20),
    crossWorkerHandovers: handovers,
    minCrossWorkerHandoverGapMs: minHandoverNs === undefined ? null : Number(minHandoverNs) / 1e6,
    disk: {
      exists: disk.exists,
      gensCount: disk.gens.length,
      maxGen: disk.gens.at(-1),
      contiguous,
      nonReleased: nonReleased.slice(0, 20),
      nonReleasedCount: nonReleased.length,
      otherNames: disk.other,
    },
    diskGensWithoutGrant: diskGensWithoutGrant.slice(0, 20),
    diskGensWithoutGrantCount: diskGensWithoutGrant.length,
    grantGensMissingOnDisk: grantGensMissingOnDisk.slice(0, 20),
    crossedDecimalWidths,
  };
  await writeJson('D2-analysis.json', analysis);
  expect.soft(dupGens, 'duplicate generations').toEqual([]);
  expect.soft(analysis.overlapsCount, 'cross-worker live-grant overlaps (QPC)').toBe(0);
  expect.soft(analysis.genOrderViolationsCount, 'generation order vs time').toBe(0);
  expect.soft(analysis.crossWorkerHandovers, 'grants alternated between workers').toBeGreaterThan(0);
  expect.soft(contiguous, 'generations contiguous 1..N').toBe(true);
  expect.soft(analysis.disk.nonReleasedCount, 'generations not released at end').toBe(0);
  expect.soft(analysis.diskGensWithoutGrantCount, 'generations without a recorded grant').toBe(0);
  expect.soft(grantGensMissingOnDisk, 'grant generations missing on disk').toEqual([]);
  expect.soft(crossedDecimalWidths.length, 'numeric generation order crossed 9->10').toBeGreaterThan(0);
  return analysis;
}

// ---------------------------------------------------------------- K3 + K9 real built API
export async function k9Owner() {
  const log = logger('K9', 'A');
  const result: Record<string, unknown> = {};
  let foreign: Awaited<ReturnType<typeof startForeign>> | undefined;
  let fixture: Awaited<ReturnType<typeof createApiProcessFixture>> | undefined;
  try {
    foreign = await startForeign(63802, '0.0.0.0', 'K9');
    await log('foreign-ready', { pid: foreign.pid, info: foreign.info });
    const tCreate0 = hr();
    fixture = await createApiProcessFixture({ portStart: 63802, portCount: 2 });
    const tCreate1 = hr();
    result.fixturePort = fixture.port;
    await log('fixture-reserved', { port: fixture.port, tCreate0, tCreate1 });
    await signal('K9-A-reserved', { port: fixture.port });
    await waitFor('K9-B-attempt1', 'B', 120_000);

    const token = await fixture.createKey();
    const child1 = fixture.run();
    const c1: { closeNs?: bigint } = {};
    child1.child.once('close', () => (c1.closeNs = hr()));
    await fixture.ready(child1, token);
    const foreignWhileApi = await httpGet('127.0.0.1', 63802, '/');
    const apiUnauth = await httpGet('127.0.0.1', fixture.port, '/loops');
    result.child1Pid = child1.child.pid;
    result.foreignWhileApi = foreignWhileApi;
    result.apiUnauth = apiUnauth;
    await log('child1-ready', { pid: child1.child.pid, foreignWhileApi, apiUnauth });
    await child1.dispose();
    const listeningAfterKill = await listening(fixture.port);
    result.listeningAfterKill = listeningAfterKill;
    await log('child1-killed', { closeNs: c1.closeNs, listeningAfterKill });
    await signal('K9-A-stopped');
    await waitFor('K9-B-attempt2', 'B', 120_000);

    const child2 = fixture.run();
    const c2: { closeNs?: bigint } = {};
    child2.child.once('close', () => (c2.closeNs = hr()));
    await fixture.ready(child2, token);
    result.child2Pid = child2.child.pid;
    result.child2Port = fixture.port;
    await log('child2-ready', { pid: child2.child.pid, port: fixture.port });
    await signal('K9-A-restarted');
    await waitFor('K9-B-attempt3', 'B', 120_000);

    await signal('K9-A-disposing');
    await waitFor('K9-B-polling', 'B', 120_000);
    const owned = fixture;
    fixture = undefined;
    const tDispose0 = hr();
    await owned.dispose();
    const tDispose1 = hr();
    result.dispose = { tDispose0, tDispose1, child2CloseNs: c2.closeNs };
    await log('disposed', { tDispose0, tDispose1, child2CloseNs: c2.closeNs });
    await signal('K9-A-disposed', { tDispose0, tDispose1, child2CloseNs: c2.closeNs });
    result.peer = await waitFor('K9-B-won', 'B', 120_000);

    result.foreignAliveAtEnd = alive(foreign.pid) && foreign.running();
    result.foreignAtEnd = await httpGet('127.0.0.1', 63802, '/');
  } catch (e) {
    await abort('A', e);
    throw e;
  } finally {
    if (fixture) result.cleanupDispose = await settle(fixture.dispose());
    if (foreign) result.foreignStop = await foreign.stop();
    await writeJson('K9-A-result.json', result);
  }
  const fw = result.foreignWhileApi as { body?: string };
  const au = result.apiUnauth as { status?: number; body?: string };
  const fe = result.foreignAtEnd as { body?: string };
  expect.soft(result.fixturePort, 'K3 fixture skipped the foreign 0.0.0.0 port').toBe(63803);
  expect.soft(fw.body ?? '', 'K3 127.0.0.1:63802 still answered by foreign').toMatch(/^foreign:0\.0\.0\.0:/);
  expect.soft(au.status, 'API answered on its port').toBeTypeOf('number');
  expect.soft(au.body ?? '', 'API port not answered by foreign').not.toMatch(/^foreign:/);
  expect.soft(result.listeningAfterKill, 'child1 killed: port TCP-free').toBe(false);
  expect.soft(result.child2Port, 'restart on same port').toBe(63803);
  expect.soft(result.foreignAliveAtEnd, 'foreign sentinel alive at end').toBe(true);
  expect.soft(fe.body ?? '', 'foreign sentinel answers at end').toMatch(/^foreign:0\.0\.0\.0:/);
  expect.soft((result.foreignStop as { exitCode?: number }).exitCode, 'foreign exits cleanly').toBe(0);
}

export async function k9Peer() {
  const log = logger('K9', 'B');
  const res: Record<string, unknown> = {};
  try {
    await waitFor('K9-A-reserved', 'A', 180_000);
    const a1 = await tryReserve(63802, 2);
    if (a1.ok) await a1.release();
    res.attempt1 = brief(a1);
    res.bind1 = await bindProbe(63803, '127.0.0.1');
    await log('attempt1-before-child', res);
    await signal('K9-B-attempt1');

    await waitFor('K9-A-stopped', 'A', 180_000);
    res.listening2 = await listening(63803);
    const a2 = await tryReserve(63802, 2);
    if (a2.ok) await a2.release();
    res.attempt2 = brief(a2);
    res.bind2 = await bindProbe(63803, '127.0.0.1');
    await log('attempt2-child-stopped', { listening2: res.listening2, attempt2: res.attempt2, bind2: res.bind2 });
    await signal('K9-B-attempt2');

    await waitFor('K9-A-restarted', 'A', 180_000);
    const a3 = await tryReserve(63802, 2);
    if (a3.ok) await a3.release();
    res.attempt3 = brief(a3);
    await log('attempt3-child-restarted', { attempt3: res.attempt3 });
    await signal('K9-B-attempt3');

    await waitFor('K9-A-disposing', 'A', 180_000);
    const attempts: ReturnType<typeof brief>[] = [];
    let win: Record<string, unknown> | undefined;
    let signalled = false;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const a = await tryReserve(63802, 2);
      if (a.ok) {
        const listeningAtWin = await listening(a.port);
        win = { ...brief(a), listeningAtWin };
        win.release = await settle(a.release());
        break;
      }
      attempts.push(brief(a));
      if (!signalled) {
        await signal('K9-B-polling');
        signalled = true;
      }
      await sleep(2);
    }
    const disposed = await waitFor('K9-A-disposed', 'A', 120_000);
    const closeNs = BigInt(String(disposed.child2CloseNs));
    const d0 = BigInt(String(disposed.tDispose0));
    const unexpected = attempts.filter((x) => !x.ok && !(x as { exhausted: boolean }).exhausted);
    const duringShutdown = attempts.filter((x) => BigInt(x.t1) >= d0 && BigInt(x.t0) <= closeNs).length;
    const refusedAfterClose = attempts.filter((x) => BigInt(x.t0) > closeNs).length;
    res.poll = {
      attempts: attempts.length,
      unexpected,
      duringShutdown,
      refusedAfterClose,
      firstAttempt: attempts[0],
      lastAttempt: attempts.at(-1),
      win,
      child2CloseNs: String(closeNs),
      tDispose0: String(d0),
      tDispose1: String(disposed.tDispose1),
      winT1AfterClose: win ? BigInt(String(win.t1)) > closeNs : false,
      winT1MinusCloseMs: win ? Number(BigInt(String(win.t1)) - closeNs) / 1e6 : null,
      winT1MinusDispose1Ms: win ? Number(BigInt(String(win.t1)) - BigInt(String(disposed.tDispose1))) / 1e6 : null,
    };
    await log('poll-result', res.poll as Record<string, unknown>);
    await writeJson('K9-B-attempts.json', attempts);
    await signal('K9-B-won', { port: win?.port, winT1AfterClose: (res.poll as { winT1AfterClose: boolean }).winT1AfterClose });
  } catch (e) {
    await abort('B', e);
    throw e;
  } finally {
    await writeJson('K9-B-result.json', res);
  }
  const ex = (x: unknown) => x as { ok: boolean; exhausted?: boolean };
  expect.soft(ex(res.attempt1).ok === false && ex(res.attempt1).exhausted, 'held before child bind').toBe(true);
  expect.soft(res.bind1, 'port TCP-free before child bind').toBe('ok');
  expect.soft(res.listening2, 'not listening after kill').toBe(false);
  expect.soft(ex(res.attempt2).ok === false && ex(res.attempt2).exhausted, 'held while child stopped').toBe(true);
  expect.soft(res.bind2, 'port TCP-free while stopped').toBe('ok');
  expect.soft(ex(res.attempt3).ok === false && ex(res.attempt3).exhausted, 'held after restart').toBe(true);
  const poll = res.poll as Record<string, unknown>;
  const win = poll.win as { port?: number; listeningAtWin?: boolean; release?: string } | undefined;
  expect.soft(poll.unexpected, 'no unexpected errors while polling').toEqual([]);
  expect.soft(poll.duringShutdown as number, 'peer polled during shutdown').toBeGreaterThan(0);
  expect.soft(win?.port, 'peer wins 63803 after settlement').toBe(63803);
  expect.soft(win?.listeningAtWin, 'not listening at win').toBe(false);
  expect.soft(poll.winT1AfterClose, 'win after owned child close').toBe(true);
  expect.soft(win?.release, 'peer release').toBe('resolved');
}

// ---------------------------------------------------------------- D1 local (K1, K2)
export async function d1Local() {
  const log = logger('D1', 'B');
  const specs = [
    { port: 63804, mode: '0.0.0.0', mustRefuse: true },
    { port: 63805, mode: 'default', mustRefuse: true },
    { port: 63806, mode: 'dual', mustRefuse: true },
    { port: 63807, mode: '127.0.0.1', mustRefuse: true },
    { port: 63808, mode: 'v6only', mustRefuse: false },
    { port: 63809, mode: '::1', mustRefuse: false },
  ];
  const foreign: Awaited<ReturnType<typeof startForeign>>[] = [];
  const res = {
    foreign: [] as unknown[],
    single: [] as { port: number; mode: string; mustRefuse: boolean; attempt: ReturnType<typeof brief> }[],
    scans: [] as ReturnType<typeof brief>[],
    scanCounts: {} as Record<string, number>,
    k2: {} as Record<string, unknown>,
    matrix: [] as unknown[],
    sentinels: [] as { port: number; mode: string; pid?: number; alive: boolean; get: { body?: string } }[],
    stops: [] as { exitCode?: number | null; forced: boolean }[],
  };
  try {
    for (const s of specs) foreign.push(await startForeign(s.port, s.mode, 'D1'));
    res.foreign = foreign.map((f) => ({ port: f.port, mode: f.mode, pid: f.pid, info: f.info }));
    await log('foreign-ready', { foreign: res.foreign });
    for (const s of specs) {
      const a = await tryReserve(s.port, 1);
      if (a.ok) await a.release();
      res.single.push({ ...s, attempt: brief(a) });
    }
    for (let i = 0; i < 20; i++) {
      const a = await tryReserve(63804, 7);
      res.scans.push(brief(a));
      if (a.ok) {
        res.scanCounts[a.port] = (res.scanCounts[a.port] ?? 0) + 1;
        await a.release();
      }
    }
    const k = await tryReserve(63810, 1);
    res.k2 = { attempt: brief(k) };
    if (k.ok) {
      res.k2.v4loop = await bindProbe(63810, '127.0.0.1');
      res.k2.v4any = await bindProbe(63810, '0.0.0.0');
      res.k2.dual = await bindProbe(63810, '::');
      res.k2.release = await settle(k.release());
    }
    for (const s of specs)
      res.matrix.push({
        port: s.port,
        mode: s.mode,
        v4loop: await bindProbe(s.port, '127.0.0.1'),
        v4any: await bindProbe(s.port, '0.0.0.0'),
        dual: await bindProbe(s.port, '::'),
      });
    for (const f of foreign) {
      const host = f.mode === 'v6only' || f.mode === '::1' ? '::1' : '127.0.0.1';
      res.sentinels.push({ port: f.port, mode: f.mode, pid: f.pid, alive: alive(f.pid) && f.running(), get: await httpGet(host, f.port, '/') });
    }
  } catch (e) {
    await abort('B', e);
    throw e;
  } finally {
    for (const f of foreign) res.stops.push({ ...(await f.stop()) });
    await writeJson('D1-B-result.json', res);
  }
  for (const s of res.single.filter((x) => x.mustRefuse)) {
    const a = s.attempt as { ok: boolean; exhausted?: boolean };
    expect.soft(a.ok === false && a.exhausted === true, `K1 ${s.mode}:${s.port} refused as exhaustion`).toBe(true);
  }
  const bad = res.scans.filter((x) => !x.ok || [63804, 63805, 63806, 63807].includes((x as { port: number }).port));
  expect.soft(bad, 'K1 range scans never grant 63804-63807 and never fail').toEqual([]);
  expect.soft((res.k2.attempt as { ok: boolean }).ok, 'K2 control grant').toBe(true);
  expect.soft([res.k2.v4loop, res.k2.v4any, res.k2.dual], 'K2 probes closed').toEqual(['ok', 'ok', 'ok']);
  for (const s of res.sentinels) {
    expect.soft(s.alive, `sentinel ${s.mode} alive`).toBe(true);
    expect.soft(s.get.body ?? '', `sentinel ${s.mode} answers`).toBe(`foreign:${s.mode}:${s.pid}`);
  }
  expect.soft(res.stops.map((s) => s.exitCode), 'sentinels exit 0').toEqual(specs.map(() => 0));
}

// ---------------------------------------------------------------- K5, K6, K8 local
const abandoned: unknown[] = [];
export async function generations() {
  const root = inject('apiPortRoot');
  const res: Record<string, Record<string, unknown>> = {};
  try {
    {
      const L1 = await reserveApiPort(63811, 1);
      const s1 = await slotState(root, 63811);
      const firstRelease = await settle(L1.release());
      const L2 = await reserveApiPort(63811, 1);
      const s2 = await slotState(root, 63811);
      const again = await settle(L1.release());
      const s3 = await slotState(root, 63811);
      const third = await tryReserve(63811, 1);
      if (third.ok) await third.release();
      const l2Release = await settle(L2.release());
      const s4 = await slotState(root, 63811);
      res.k5a = { kind: 'native', s1, firstRelease, s2, again, s3, third: brief(third), l2Release, s4 };
    }
    {
      const L = await reserveApiPort(63812, 1);
      const s1 = await slotState(root, 63812);
      const gen = join(root, '63812', '1');
      const mine = s1.entries['1']?.[0] ?? '';
      const replacement = randomUUID();
      await rmdir(join(gen, mine));
      await mkdir(join(gen, replacement));
      const rel = await settle(L.release());
      const s2 = await slotState(root, 63812);
      const after = await tryReserve(63812, 1);
      if (after.ok) await after.release();
      res.k5b = { kind: 'controlled', s1, mine, replacement, rel, s2, after: brief(after) };
    }
    {
      const L4 = await reserveApiPort(63813, 1);
      const s1 = await slotState(root, 63813);
      const gen = join(root, '63813', '1');
      const mine = s1.entries['1']?.[0] ?? '';
      await rmdir(join(gen, mine));
      await rmdir(gen);
      const L5 = await reserveApiPort(63813, 1);
      const s2 = await slotState(root, 63813);
      const stale = await settle(L4.release());
      const s3 = await slotState(root, 63813);
      const blocked = await tryReserve(63813, 1);
      if (blocked.ok) await blocked.release();
      const own = await settle(L5.release());
      const s4 = await slotState(root, 63813);
      res.k5c = { kind: 'controlled', s1, mine, s2, stale, s3, blocked: brief(blocked), own, s4 };
    }
    {
      const L6 = await reserveApiPort(63814, 1);
      abandoned.push(L6);
      const s1 = await slotState(root, 63814);
      const again = await tryReserve(63814, 1);
      if (again.ok) await again.release();
      res.k6a = { kind: 'native (abandoned lease = crashed holder state)', s1, again: brief(again) };
      await signal('K6a-abandoned');
    }
    {
      await mkdir(join(root, '63815', '1', 'released'), { recursive: true });
      await mkdir(join(root, '63815', '2'));
      const a = await tryReserve(63815, 1);
      if (a.ok) await a.release();
      const s = await slotState(root, 63815);
      res.k6b = { kind: 'controlled', attempt: brief(a), s };
    }
    {
      for (let g = 1; g <= 10; g++) await mkdir(join(root, '63816', String(g), 'released'), { recursive: true });
      const a = await tryReserve(63816, 1);
      const s1 = await slotState(root, 63816);
      const rel = a.ok ? await settle(a.release()) : undefined;
      const s2 = await slotState(root, 63816);
      res.k8 = { kind: 'controlled', attempt: brief(a), s1, rel, s2 };
    }
  } catch (e) {
    await abort('B', e);
    throw e;
  } finally {
    await writeJson('GEN-B-result.json', res);
  }
  type S = { gens: number[]; entries: Record<string, string[]> };
  const k5a = res.k5a as { s2: S; s3: S; s4: S; again: string; firstRelease: string; l2Release: string; third: { ok: boolean; exhausted?: boolean } };
  expect.soft(k5a.firstRelease, 'K5a first release').toBe('resolved');
  expect.soft(k5a.s2.gens, 'K5a generations').toEqual([1, 2]);
  expect.soft(UUID.test(k5a.s2.entries['2']?.[0] ?? ''), 'K5a gen2 live').toBe(true);
  expect.soft(k5a.again, 'K5a repeated release resolves').toBe('resolved');
  expect.soft(k5a.s3, 'K5a repeated release changed nothing').toEqual(k5a.s2);
  expect.soft(k5a.third.ok === false && k5a.third.exhausted, 'K5a port still reserved').toBe(true);
  expect.soft(k5a.l2Release, 'K5a L2 release').toBe('resolved');
  expect.soft(k5a.s4.entries, 'K5a final').toEqual({ '1': ['released'], '2': ['released'] });

  const k5b = res.k5b as { s2: S; rel: string; replacement: string; after: { ok: boolean; exhausted?: boolean } };
  expect.soft(k5b.rel.startsWith('rejected:'), 'K5b release after replacement rejects visibly').toBe(true);
  expect.soft(k5b.s2.entries, 'K5b replacement preserved').toEqual({ '1': [k5b.replacement] });
  expect.soft(k5b.after.ok === false && k5b.after.exhausted, 'K5b port still reserved').toBe(true);

  const k5c = res.k5c as { mine: string; s2: S; s3: S; s4: S; stale: string; own: string; blocked: { ok: boolean; exhausted?: boolean } };
  const newMarker = k5c.s2.entries['1']?.[0] ?? '';
  expect.soft(UUID.test(newMarker) && newMarker !== k5c.mine, 'K5c new lease has its own marker').toBe(true);
  expect.soft(k5c.stale.startsWith('rejected:'), 'K5c stale release rejects visibly').toBe(true);
  expect.soft(k5c.s3, 'K5c stale release preserved the replacement').toEqual(k5c.s2);
  expect.soft(k5c.blocked.ok === false && k5c.blocked.exhausted, 'K5c port still reserved').toBe(true);
  expect.soft(k5c.own, 'K5c replacement owner release').toBe('resolved');
  expect.soft(k5c.s4.entries, 'K5c final').toEqual({ '1': ['released'] });

  const k6a = res.k6a as { again: { ok: boolean; exhausted?: boolean } };
  expect.soft(k6a.again.ok === false && k6a.again.exhausted, 'K6a abandoned lease stays reserved').toBe(true);
  const k6b = res.k6b as { attempt: { ok: boolean; exhausted?: boolean }; s: S };
  expect.soft(k6b.attempt.ok === false && k6b.attempt.exhausted, 'K6b incomplete newest stays reserved').toBe(true);
  expect.soft(k6b.s.entries, 'K6b unchanged').toEqual({ '1': ['released'], '2': [] });
  const k8 = res.k8 as { attempt: { ok: boolean; port?: number }; s1: S; rel?: string; s2: S };
  expect.soft(k8.attempt.ok && k8.attempt.port === 63816, 'K8 grant after 10 released generations').toBe(true);
  expect.soft(k8.s1.gens.at(-1), 'K8 new generation is 11').toBe(11);
  expect.soft(UUID.test(k8.s1.entries['11']?.[0] ?? ''), 'K8 gen 11 live').toBe(true);
  expect.soft(k8.rel, 'K8 release').toBe('resolved');
  expect.soft(k8.s2.entries['11'], 'K8 gen 11 released').toEqual(['released']);
}

// ---------------------------------------------------------------- K7 native ACL
export async function aclCases() {
  const root = inject('apiPortRoot');
  const user = execFileSync('C:\\Windows\\System32\\whoami.exe', { encoding: 'utf8' }).trim();
  const icacls = (args: string[]) => {
    const r = spawnSync('C:\\Windows\\System32\\icacls.exe', args, { encoding: 'utf8' });
    return { args, status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
  };
  const res: Record<string, Record<string, unknown> | string> = { user };
  try {
    {
      const L = await reserveApiPort(63817, 1);
      const r: Record<string, unknown> = { kind: 'native ACL', setupRelease: await settle(L.release()) };
      res.k7a = r;
      const slot = join(root, '63817');
      r.before = icacls([slot]);
      r.deny = icacls([slot, '/deny', `${user}:(AD)`]);
      try {
        r.withDeny = icacls([slot]);
        const a = await tryReserve(63817, 1);
        if (a.ok) await a.release();
        r.attempt = brief(a);
        r.stateDuring = await slotState(root, 63817);
      } finally {
        r.undo = icacls([slot, '/remove:d', user]);
        r.after = icacls([slot]);
      }
      const b = await tryReserve(63817, 1);
      r.afterAttempt = brief(b);
      if (b.ok) r.afterRelease = await settle(b.release());
      r.stateEnd = await slotState(root, 63817);
    }
    {
      const L = await reserveApiPort(63818, 1);
      const r: Record<string, unknown> = { kind: 'native ACL' };
      res.k7b = r;
      const gen = join(root, '63818', '1');
      r.stateHeld = await slotState(root, 63818);
      r.deny = icacls([gen, '/deny', `${user}:(AD)`]);
      try {
        r.withDeny = icacls([gen]);
        const p1 = L.release();
        const p2 = L.release();
        r.samePromise = p1 === p2;
        r.first = await settle(p1);
        r.second = await settle(p2);
        r.stateDuring = await slotState(root, 63818);
      } finally {
        r.undo = icacls([gen, '/remove:d', user]);
        r.after = icacls([gen]);
      }
      r.thirdAfterUndo = await settle(L.release());
      const c = await tryReserve(63818, 1);
      if (c.ok) await c.release();
      r.blockedAfter = brief(c);
      r.stateEnd = await slotState(root, 63818);
    }
  } catch (e) {
    await abort('B', e);
    throw e;
  } finally {
    await writeJson('ACL-B-result.json', res);
  }
  type I = { status: number | null; out: string };
  const k7a = res.k7a as Record<string, unknown>;
  const at = k7a.attempt as { ok: boolean; exhausted?: boolean; code?: string; message?: string };
  expect.soft((k7a.deny as I).status, 'K7a deny applied').toBe(0);
  expect.soft((k7a.withDeny as I).out, 'K7a deny visible').toMatch(/\(DENY\)/);
  expect.soft(at.ok, 'K7a reservation refused').toBe(false);
  expect.soft(at.exhausted, 'K7a not reported as exhaustion').toBe(false);
  expect.soft(['EPERM', 'EACCES'], 'K7a raw permission code').toContain(at.code);
  expect.soft(at.message ?? '', 'K7a raw mkdir error').toMatch(/mkdir/);
  expect.soft((k7a.undo as I).status, 'K7a deny removed').toBe(0);
  expect.soft((k7a.after as I).out, 'K7a no deny after').not.toMatch(/\(DENY\)/);
  expect.soft((k7a.afterAttempt as { ok: boolean }).ok, 'K7a grant after undo').toBe(true);
  expect.soft(k7a.afterRelease, 'K7a release after undo').toBe('resolved');
  const k7b = res.k7b as Record<string, unknown>;
  expect.soft((k7b.deny as I).status, 'K7b deny applied').toBe(0);
  expect.soft(k7b.samePromise, 'K7b memoised release').toBe(true);
  expect.soft(String(k7b.first), 'K7b release permission error visible').toMatch(/^rejected:(EPERM|EACCES):/);
  expect.soft(k7b.second, 'K7b second call same rejection').toBe(k7b.first);
  expect.soft((k7b.undo as I).status, 'K7b deny removed').toBe(0);
  expect.soft((k7b.after as I).out, 'K7b no deny after').not.toMatch(/\(DENY\)/);
  expect.soft(k7b.thirdAfterUndo, 'K7b no retry after undo (memoised)').toBe(k7b.first);
  const blocked = k7b.blockedAfter as { ok: boolean; exhausted?: boolean };
  expect.soft(blocked.ok === false && blocked.exhausted, 'K7b unreleased generation stays reserved').toBe(true);
}
