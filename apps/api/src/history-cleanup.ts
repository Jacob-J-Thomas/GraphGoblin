import { StorageStatusSchema, type StorageStatus } from '@graphgoblin/contracts';
import type { ClockPort, Logger } from '@graphgoblin/engine';
import type { StorageCapacityPort } from '@graphgoblin/infrastructure/fs';
import type { SqliteHistoryCleanup } from '@graphgoblin/infrastructure/sqlite';

/** Engineering headroom/hysteresis, not an owner-approved retention policy. */
const INTERVAL_MS = 60_000;
const GiB = 1024 ** 3;

export class HistoryCleanup {
  private snapshot: StorageStatus = {
    state: 'unavailable',
    checkedAt: null,
    volumes: [],
    cleaning: false,
    deletedRuns: 0,
    removedFileBytes: 0,
    reusableDatabaseBytes: 0,
    pendingResources: 0,
    preservedResources: 0,
  };
  private lastCheck = -Infinity;
  private pressured = false;
  private stopped = false;
  private active: Promise<void> | undefined;
  private listening = false;
  private timerRequested = false;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly capacity: StorageCapacityPort,
    private readonly store: Pick<
      SqliteHistoryCleanup,
      'prepareBatch' | 'reapBatch' | 'reusableBytes' | 'hasApprovedCandidates' | 'pendingResources'
    >,
    private readonly paths: { name: 'data' | 'database'; path: string }[],
    private readonly clock: ClockPort,
    private readonly logger: Logger,
  ) {}

  status(): StorageStatus {
    return StorageStatusSchema.parse(this.snapshot);
  }

  async start(timer: boolean): Promise<void> {
    this.timerRequested = timer;
    this.lastCheck = this.clock.now().getTime();
    this.active = this.pass(false).finally(() => {
      this.active = undefined;
    });
    await this.active;
  }

  /** The composition calls this only once the HTTP listener is accepting connections. */
  afterListen(): void {
    if (this.listening || this.stopped) return;
    this.listening = true;
    this.active = this.clean().finally(() => {
      this.active = undefined;
    });
    if (this.timerRequested) {
      this.timer = setInterval(() => {
        void this.poll();
      }, INTERVAL_MS);
      this.timer.unref();
    }
  }

  poll(): Promise<void> {
    if (this.active) return this.active;
    const now = this.clock.now().getTime();
    if (this.stopped || now - this.lastCheck < INTERVAL_MS) return Promise.resolve();
    this.lastCheck = now;
    this.active = this.pass().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async pass(clean = true): Promise<void> {
    const attemptedAt = this.clock.now().toISOString();
    try {
      const volumes = await Promise.all(
        this.paths.map(async ({ name, path }) => ({ name, ...(await this.capacity.read(path)) })),
      );
      for (const volume of volumes)
        if (
          !Number.isSafeInteger(volume.totalBytes) ||
          volume.totalBytes <= 0 ||
          !Number.isSafeInteger(volume.availableBytes) ||
          volume.availableBytes < 0 ||
          volume.availableBytes > volume.totalBytes
        )
          throw new Error('Capacity unavailable');
      // Relative headroom for small volumes; absolute cap avoids cleaning at tens of GiB free.
      this.pressured = volumes.some(
        (volume) =>
          volume.availableBytes <
          (this.pressured
            ? Math.min(2 * GiB, volume.totalBytes * 0.1)
            : Math.min(GiB, volume.totalBytes * 0.05)),
      );
      const pending = await this.store.pendingResources();
      this.snapshot = {
        ...this.snapshot,
        checkedAt: attemptedAt,
        volumes,
        reusableDatabaseBytes: await this.store.reusableBytes(),
        cleaning: false,
        deletedRuns: 0,
        removedFileBytes: 0,
        pendingResources: pending,
        preservedResources: pending,
        state: this.pressured ? 'pressure' : 'adequate',
      };
      if (clean) await this.clean();
    } catch {
      this.snapshot = {
        ...this.snapshot,
        state: 'unavailable',
        checkedAt: attemptedAt,
        volumes: [],
        deletedRuns: 0,
        removedFileBytes: 0,
      };
      this.logger.warn(
        {},
        'Storage measurement or cleanup could not finish; no deletion scope was broadened',
      );
    } finally {
      this.snapshot = { ...this.snapshot, cleaning: false };
    }
  }

  private async clean(): Promise<void> {
    try {
      if (!this.pressured || this.stopped || this.snapshot.state === 'unavailable') return;
      this.snapshot = { ...this.snapshot, cleaning: true };
      const deletedRuns = await this.store.prepareBatch('local');
      let result;
      if (this.stopped) {
        const pending = await this.store.pendingResources();
        result = { bytes: 0, pending, preserved: pending, remaining: pending > 0 };
      } else result = await this.store.reapBatch(this.abort.signal);
      const reusableDatabaseBytes = await this.store.reusableBytes();
      // A bounded pass may leave candidates behind. Do not claim none exist without a final
      // indexed probe, including approvals committed while this pass was reaping resources.
      const candidatesRemain = await this.store.hasApprovedCandidates('local');
      this.snapshot = {
        ...this.snapshot,
        deletedRuns,
        removedFileBytes: result.bytes,
        reusableDatabaseBytes,
        pendingResources: result.pending,
        preservedResources: result.preserved,
        state:
          deletedRuns || result.bytes || candidatesRemain || result.remaining
            ? 'pressure'
            : 'no-eligible',
      };
      this.logger.warn(
        { deletedRuns, pendingResources: result.pending, preservedResources: result.preserved },
        'Storage pressure: cleanup is limited to confirmed eligible history',
      );
    } catch {
      this.snapshot = { ...this.snapshot, state: 'unavailable' };
      this.logger.warn({}, 'Storage cleanup could not finish; protected resources stay kept');
    } finally {
      this.snapshot = { ...this.snapshot, cleaning: false };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
