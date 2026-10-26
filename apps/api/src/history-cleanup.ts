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
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly capacity: StorageCapacityPort,
    private readonly store: Pick<
      SqliteHistoryCleanup,
      'prepareBatch' | 'reapBatch' | 'reusableBytes'
    >,
    private readonly paths: { name: 'data' | 'database'; path: string }[],
    private readonly clock: ClockPort,
    private readonly logger: Logger,
  ) {}

  status(): StorageStatus {
    return StorageStatusSchema.parse(this.snapshot);
  }

  async start(timer: boolean): Promise<void> {
    await this.poll();
    if (timer && !this.stopped) {
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

  private async pass(): Promise<void> {
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
      this.snapshot = {
        ...this.snapshot,
        checkedAt: this.clock.now().toISOString(),
        volumes,
        reusableDatabaseBytes: await this.store.reusableBytes(),
        cleaning: this.pressured,
        deletedRuns: 0,
        removedFileBytes: 0,
        preservedResources: 0,
        state: this.pressured ? 'pressure' : 'adequate',
      };
      if (!this.pressured || this.stopped) return;
      const deletedRuns = await this.store.prepareBatch('local');
      const result = this.stopped
        ? { bytes: 0, pending: this.snapshot.pendingResources, preserved: 0 }
        : await this.store.reapBatch();
      this.snapshot = {
        ...this.snapshot,
        deletedRuns,
        removedFileBytes: result.bytes,
        reusableDatabaseBytes: await this.store.reusableBytes(),
        pendingResources: result.pending,
        preservedResources: result.preserved,
        state: deletedRuns || result.bytes ? 'pressure' : 'no-eligible',
      };
      this.logger.warn(
        { deletedRuns, pendingResources: result.pending, preservedResources: result.preserved },
        'Storage pressure: cleanup is limited to confirmed eligible history',
      );
    } catch {
      this.snapshot = { ...this.snapshot, state: 'unavailable' };
      this.logger.warn(
        {},
        'Storage measurement or cleanup could not finish; no deletion scope was broadened',
      );
    } finally {
      this.snapshot = { ...this.snapshot, cleaning: false };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
