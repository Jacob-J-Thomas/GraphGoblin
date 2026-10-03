import type { JsonValue } from '@graphgoblin/contracts';

export interface InboundEvent {
  id: string;
  ownerId: string;
  type: string;
  payload: JsonValue;
  dedupeKey?: string;
  receivedAt: string;
}

export type InboundEventListener = (event: InboundEvent) => void | Promise<void>;

/**
 * The gateway's in-process event bus. Exit nodes publish onto it through the `event` return
 * channel; the trigger service subscribes, stores each event in `inbound_events`, and fires event
 * triggers. `POST /events` calls the trigger service directly so it can return the started runs.
 * The recent buffer is a debugging aid; `GET /events` reads the table.
 */
export class InboundEventBus {
  private listeners: InboundEventListener[] = [];
  private readonly recent: InboundEvent[] = [];

  constructor(private readonly keep = 200) {}

  subscribe(listener: InboundEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async publish(event: InboundEvent): Promise<void> {
    this.recent.push(event);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    for (const listener of this.listeners) await listener(event);
  }

  list(ownerId: string): InboundEvent[] {
    return this.recent
      .filter((e) => e.ownerId === ownerId)
      .slice()
      .reverse();
  }
}
