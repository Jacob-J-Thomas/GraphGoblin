// Built product composition, real SQLite and ProcessScripts. Only public port decorators
// delay scheduling and lose two runner acknowledgements AFTER the real script has exited.
// This deterministically exercises the audit's interleaving without a provider or private API.
import fs from 'node:fs';
import path from 'node:path';
import { createContainer, loadConfig, buildApp } from '../../../apps/api/dist/index.js';
import { RunManager } from '../../../packages/engine/dist/index.js';
import { ProcessScripts } from '../../../packages/infrastructure/dist/process/index.js';
const scenario = process.env.QA_SCENARIO;
const effectFile = path.join(process.env.GG_DATA_DIR, 'effects.jsonl');
const runner = new ProcessScripts();
const count = () => fs.existsSync(effectFile) ? fs.readFileSync(effectFile, 'utf8').trim().split('\n').length : 0;
const logger = Object.fromEntries(['debug','info','warn','error'].map((level) => [level, (...args) => console.error(JSON.stringify({ level, args }))]));
const base = await createContainer(loadConfig(process.env), {
  startTimers: false, logger,
  scripts: { run: async (request) => {
    const result = await runner.run(request);
    if (count() === 1 || count() === 3 && scenario !== 'different')
      throw Error('QA injected lost runner acknowledgement after real external effect');
    return result;
  } },
});
// On reopen, start exactly one manager. Starting base's manager first would race recovery.
if (scenario === 'reboot') await base.handle.migrate();
else await base.start();
base.manager.stop();
let parentId, childId, armed = false, failureBlocked = false, childBlocked = false, readBlocked = false;
const gates = new Map();
const gate = (name) => new Promise((resolve) => { gates.set(name, resolve); process.send?.({ type: name, parentId, childId }); });
const store = base.ports.events;
const events = {
  recoveryFacts: (...args) => store.recoveryFacts(...args),
  subscribe: (...args) => store.subscribe(...args),
  append: async (id, drafts, options) => {
    const failure = drafts.find((d) => d.type === 'run.failed' && d.failure.details?.childRunId);
    if (failure) { parentId = id; childId = failure.failure.details.childRunId; }
    if (failure && ['early','different'].includes(scenario) && !failureBlocked) {
      failureBlocked = true; await gate('parent-failure-blocked');
    }
    if (id === childId && ['early','different'].includes(scenario) && !childBlocked && drafts.some((d) => d.type === 'run.resumed')) {
      childBlocked = true; await gate('child-resume-blocked');
    }
    return store.append(id, drafts, options);
  },
  read: async (...args) => {
    const rows = await store.read(...args);
    if (armed && args[0] === parentId && !readBlocked && rows.some((e) => e.type === 'run.resumed')) {
      readBlocked = true; await gate('parent-read-blocked');
    }
    return rows;
  },
};
const manager = new RunManager({ ...base.ports, events }, base.settings);
await manager.start();
const app = await buildApp({ ...base, manager }, { logger: false });
await app.listen({ host: '127.0.0.1', port: Number(process.env.GG_PORT) });
process.send?.({ type: 'ready', pid: process.pid });
process.on('message', async (message) => {
  if (message.type === 'arm') { armed = true; parentId = message.parentId; childId = message.childId; process.send?.({ type: 'armed' }); }
  if (message.type === 'release') gates.get(message.name)?.();
  if (message.type === 'stop') {
    for (const release of gates.values()) release();
    await app.close(); manager.stop(); await base.dispose(); process.exit(0);
  }
});
