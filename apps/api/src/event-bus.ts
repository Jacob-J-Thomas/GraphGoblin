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
 * The gateway's inbound event bus. Exit nodes publish onto it through the `event` return channel,
 * `POST /events` publishes onto it, and (from M6) event trigger nodes subscribe to it.
 * In-process in 1.0; the recent buffer lets the API show what arrived.
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
