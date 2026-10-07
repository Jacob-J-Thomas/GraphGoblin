import type {
  JsonValue,
  LoopDefinition,
  LoopDefinitionInput,
  LoopVersionRecord,
  NodeKind,
  RunEvent,
  RunRecord,
} from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { RunManager, type StartRunInput } from '../run-manager.js';
import type { EngineSettings } from '../ports.js';
import { DEFAULT_TEST_SETTINGS, createFakePorts, type FakePorts } from './fakes.js';

/** A run manager over fake ports with helpers for scenario tests. */
export interface TestEngine {
  ports: FakePorts;
  manager: RunManager;
  settings: EngineSettings;
  /** Register a published version. The loop id is derived from the name unless given. */
  publish(
    def: LoopDefinitionInput,
    options?: { loopId?: string; version?: number; status?: 'draft' | 'published' },
  ): LoopVersionRecord;
  /** Start a run from a manual trigger. */
  start(loopId: string, payload?: JsonValue, extra?: Partial<StartRunInput>): Promise<RunRecord>;
  /** Start a run and wait until the manager is idle. Returns the final record. */
  runToIdle(
    loopId: string,
    payload?: JsonValue,
    extra?: Partial<StartRunInput>,
  ): Promise<RunRecord>;
  /** Wait for idle and fetch the run. */
  settle(runId: string): Promise<RunRecord>;
  events(runId: string): RunEvent[];
  eventTypes(runId: string): string[];
  loopId(name: string): string;
}

export async function createTestEngine(
  overrides: Partial<EngineSettings> = {},
  portOptions: { secrets?: Record<string, string> } = {},
): Promise<TestEngine> {
  const ports = createFakePorts(portOptions);
  const settings: EngineSettings = { ...DEFAULT_TEST_SETTINGS, ...overrides };
  const manager = new RunManager(ports, settings);
  await manager.start();
  const loopId = (name: string): string => fakeUlid(`loop:${name}`);
  const engine: TestEngine = {
    ports,
    manager,
    settings,
    loopId,
    publish(def, options = {}) {
      const parsed: LoopDefinition = LoopDefinitionSchema.parse(def);
      const id = options.loopId ?? loopId(parsed.name);
      const version = options.version ?? 1;
      const record: LoopVersionRecord = {
        id: fakeUlid(`version:${id}:${version}`),
        loopId: id,
        version,
        status: options.status ?? 'published',
        definition: parsed,
        createdAt: '2026-10-02T11:00:00.000Z',
        ...(options.status === 'draft' ? {} : { publishedAt: '2026-10-02T11:00:00.000Z' }),
      };
      ports.loops.add(record);
      return record;
    },
    start(id, payload = null, extra = {}) {
      return manager.startRun({
        ownerId: 'local',
        loopId: id,
        source: 'manual.api',
        payload,
        ...extra,
      });
    },
    async runToIdle(id, payload = null, extra = {}) {
      const run = await engine.start(id, payload, extra);
      return engine.settle(run.id);
    },
    async settle(runId) {
      await manager.waitForIdle();
      const run = await ports.runs.get(runId);
      if (!run) throw new Error(`run ${runId} vanished`);
      return run;
    },
    events(runId) {
      return ports.events.all(runId);
    },
    eventTypes(runId) {
      return ports.events.all(runId).map((e) => e.type);
    },
  };
  return engine;
}

/** A loop with one node between trigger and exit. */
/** Loose node shape for tests: configs are validated by the schemas when the loop is published. */
export interface TestNode {
  id: string;
  kind: NodeKind;
  label: string;
  config: unknown;
}

export function singleNodeLoop(
  name: string,
  testNode: TestNode,
  exitConfig: Record<string, unknown> = {},
): LoopDefinitionInput {
  const node = testNode as unknown as LoopDefinitionInput['nodes'][number];
  const extraEdges =
    node.kind === 'decision'
      ? []
      : [{ id: 'e2', from: { node: node.id, port: 'out' }, to: { node: 'done' } }];
  return {
    schemaVersion: 2,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      node,
      { id: 'done', kind: 'exit', label: 'Done', config: exitConfig },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: node.id } },
      ...extraEdges,
    ],
  };
}
