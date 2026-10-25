import type { RunRecord } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
import {
  AdmissionConflictError,
  assertEventClaim,
  parseRunAdmission,
  type EventAdmissionPort,
  type EventClaim,
  type EventFailureCode,
  type EventReceipt,
  type RunAdmission,
} from '../admission.js';

export class InMemoryEventAdmission implements EventAdmissionPort {
  readonly receipts = new Map<string, EventReceipt>();
  constructor(
    readonly createRun: (intent: RunAdmission, onCommitted: () => void) => Promise<RunRecord>,
    readonly hasKey: (owner: string, loop: string, node: string, key: string) => boolean,
  ) {}
  find(owner: string, loop: string, type: string, key: string, node?: string) {
    return Promise.resolve(
      [...this.receipts.values()]
        .filter(
          (r) =>
            r.ownerId === owner &&
            r.loopId === loop &&
            r.inbound.type === type &&
            r.inbound.dedupeKey === key &&
            (!node || r.triggerNodeId === node),
        )
        .map((r) => structuredClone(r)),
    );
  }
  claim(claim: EventClaim, authored: RunAdmission) {
    const intent = parseRunAdmission(authored);
    assertEventClaim(claim, intent);
    const { implicitEntry, ...input } = claim;
    const priors =
      input.inbound.dedupeKey !== undefined
        ? [...this.receipts.values()].filter(
            (r) =>
              r.ownerId === input.ownerId &&
              r.loopId === input.loopId &&
              (implicitEntry || r.triggerNodeId === input.triggerNodeId) &&
              r.inbound.type === input.inbound.type &&
              r.inbound.dedupeKey === input.inbound.dedupeKey,
          )
        : [];
    if (priors.length > 1) return Promise.reject(new AdmissionConflictError());
    const [prior] = priors;
    if (prior) return Promise.resolve({ receipt: structuredClone(prior), duplicate: true });
    const key = intent.initialThread.invocation.trigger.dedupeKey;
    const seen =
      !!input.nodeDedupeKey &&
      !!key &&
      ([...this.receipts.values()].some(
        (r) =>
          r.ownerId === input.ownerId &&
          r.loopId === input.loopId &&
          r.triggerNodeId === input.triggerNodeId &&
          (r.status === 'pending' || r.status === 'admitted') &&
          r.intent?.initialThread.invocation.trigger.dedupeKey === key,
      ) ||
        this.hasKey(input.ownerId, input.loopId, input.triggerNodeId, key));
    const receipt: EventReceipt = {
      ...structuredClone(input),
      status: seen ? 'deduplicated' : 'pending',
      attempts: 0,
      ...(!seen ? { intent, nextAttemptAt: input.inbound.receivedAt } : {}),
    };
    this.receipts.set(receipt.id, receipt);
    return Promise.resolve({ receipt: structuredClone(receipt), duplicate: false });
  }
  get(id: string) {
    return Promise.resolve(structuredClone(this.receipts.get(id)));
  }
  async create(intent: RunAdmission, id: string) {
    const receipt = this.receipts.get(id);
    if (
      !receipt?.intent ||
      !['pending', 'admitted'].includes(receipt.status) ||
      stableStringify(receipt.intent) !== stableStringify(intent)
    )
      throw new AdmissionConflictError();
    assertEventClaim(receipt, intent);
    return this.createRun(intent, () => {
      receipt.status = 'admitted';
      receipt.inbound.runIds = [intent.run.id];
      delete receipt.failureCode;
      delete receipt.nextAttemptAt;
    });
  }
  due(now: string, limit: number, afterId?: string) {
    return Promise.resolve(
      [...this.receipts.values()]
        .filter(
          (r) =>
            r.status === 'pending' &&
            r.nextAttemptAt &&
            r.nextAttemptAt <= now &&
            (afterId === undefined || r.id > afterId),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, Math.max(0, Math.min(5, limit)))
        .map(({ id, attempts }) => ({ id, attempts })),
    );
  }
  failed(id: string, code: EventFailureCode, nextAttemptAt?: string) {
    const receipt = this.receipts.get(id);
    if (receipt?.status === 'pending') {
      receipt.attempts++;
      receipt.failureCode = code;
      if (nextAttemptAt) receipt.nextAttemptAt = nextAttemptAt;
      else {
        receipt.status = 'failed';
        delete receipt.nextAttemptAt;
      }
    }
    return Promise.resolve();
  }
  hasPendingPin(loopId: string) {
    return Promise.resolve(
      [...this.receipts.values()].some(
        (r) => r.status === 'pending' && r.intent?.pinnedLoopIds.includes(loopId),
      ),
    );
  }
}
