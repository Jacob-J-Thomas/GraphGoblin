import type { RunEvent } from '@graphgoblin/contracts';

/** Fresh starts from this run's durable log, independent of replay-seed/display counters. */
export class FreshEntries {
  private readonly counts = new Map<string, number>();

  constructor(history: readonly RunEvent[]) {
    this.record(history);
  }

  /** Called only after append resolves; a rejected/uncertain append is reconciled next execution. */
  record(committed: readonly RunEvent[]): void {
    for (const event of committed) {
      if (event.type === 'node.started' && event.attempt === 1) {
        this.counts.set(event.nodeId, this.count(event.nodeId) + 1);
      }
    }
  }

  count(nodeId: string): number {
    return this.counts.get(nodeId) ?? 0;
  }
}
