import { expect, it } from 'vitest';
import { LoopDefinitionSchema, type RunEvent, type RunRecord } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { RunFailureError, UnreadableRunHistoryError } from './errors.js';
import { RunManager } from './run-manager.js';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  InMemoryEventStore,
  InMemoryRunRepository,
  InMemoryTriggerAdmission,
} from './testing/fakes.js';

class DamagedRead extends InMemoryRunRepository {
  crashed = false;
  readsAfterCrash = 0;
  override get(id: string): Promise<RunRecord | undefined> {
    if (this.crashed && ++this.readsAfterCrash === 1)
      return Promise.reject(new UnreadableRunHistoryError(id, 'damaged row'));
    return super.get(id);
  }
}

it('still attempts post-execution bookkeeping when recording an executor crash cannot read the run', async () => {
  const ports = createFakePorts();
  const runs = new DamagedRead();
  class CrashingEvents extends InMemoryEventStore {
    override async read(id: string, after?: number, limit?: number): Promise<RunEvent[]> {
      if (!runs.crashed) {
        await runs.update(id, { cancelRequestedAt: FIXTURE_TS });
        runs.crashed = true;
        throw new RunFailureError('SECRET_MISSING', 'executor fault');
      }
      return super.read(id, after, limit);
    }
  }
  const events = new CrashingEvents(ports.clock);
  const manager = new RunManager(
    { ...ports, runs, events, admission: new InMemoryTriggerAdmission(runs, events, ports.loops) },
    DEFAULT_TEST_SETTINGS,
  );
  const loopId = fakeUlid('crash-loop');
  ports.loops.add({
    id: fakeUlid('crash-version'),
    loopId,
    version: 1,
    status: 'published',
    createdAt: FIXTURE_TS,
    definition: LoopDefinitionSchema.parse(minimalLoop()),
  });
  await manager.start();
  const run = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
  await manager.waitForIdle();
  expect((await runs.get(run.id))?.status).toBe('cancelled');
  expect(events.all(run.id).map((event) => event.type)).toContain('run.cancelled');
  expect(ports.logger.lines.map((line) => line.msg)).toContain(
    'executor crash could not be recorded',
  );
  expect(ports.logger.lines.map((line) => line.msg)).not.toContain(
    'post-execution cancellation failed',
  );
  manager.stop();
});
