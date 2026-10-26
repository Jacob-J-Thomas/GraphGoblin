// Check 4 (#205), stored data. Simulates a store written before this change. With the gateway
// stopped, s7-store-edit.mjs edits its SQLite file the way an older build could have left it:
//  Phase 1 (nodes): the gpt-5.5 model_catalog row lists max again (the old seed), and a published
//    inference node and a published LLM decision use gpt-5.5 at max. After restart the seed must
//    drop max for gpt-5.5 and both stored values must be refused with EFFORT_UNSUPPORTED before any
//    CLI request (as apps/web/e2e/model-effort.spec.ts expects for a saved unsupported effort:
//    EVALUATION_INVALID_CONFIGURATION with details.code EFFORT_UNSUPPORTED). A control loop at
//    gpt-6-luna/max still runs and sends max.
//  Phase 2 (settings): owner Settings default Codex to gpt-5.5 at max. An inheriting node must be
//    refused before any request.
// Attempt 1 edited both at once; the invalid owner default then failed every Codex run
// (attempts/s7-attempt1-*), so the phases are now separate.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s7-stored-effort');
const dir = L.makeStore('s7');
const dbPath = path.join(dir, 'graphgoblin.db');
const gateways = [];
const edit = (...args) => JSON.parse(execFileSync(L.NODE, [path.join(L.OUT, 'scripts', 's7-store-edit.mjs'), dbPath, ...args], { windowsHide: true }).toString());

function inference(name, marker, config) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'work', kind: 'inference', label: 'Work', config: { harness: 'codex', prompt: { template: `${marker} run={{ run.id }} task.` }, ...config } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 's-w', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'w-d', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
function decision(name, marker) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: `${marker} run={{ run.id }} choose`,
          model: { mode: 'explicit', value: 'gpt-6-luna' },
          effort: { mode: 'explicit', value: 'max' },
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 's-p', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'p-y', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
      { id: 'p-n', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
    ],
  };
}

async function runAll(g, cli, loops) {
  const out = {};
  for (const [label, loopId, marker] of loops) {
    const started = await g.call(`/loops/${loopId}/runs`, { method: 'POST', body: {} });
    let run;
    if (started.status === 202) run = await L.waitRun(g.call, started.json.run.id, ['succeeded', 'failed'], 30_000);
    out[label] = {
      start: started.status,
      startBody: started.status === 202 ? undefined : started.json,
      status: run?.status,
      failure: run?.failure,
      requests: cli.requests().filter((q) => q.prompt.includes(marker) && run && q.prompt.includes(run.id)).map((q) => ({ model: q.model, effort: q.effort })),
    };
  }
  return out;
}
const refusedUnsupported = (o) =>
  (o.start >= 400 && JSON.stringify(o.startBody).includes('EFFORT_UNSUPPORTED')) ||
  (o.status === 'failed' && (o.failure?.code === 'EFFORT_UNSUPPORTED' || o.failure?.details?.code === 'EFFORT_UNSUPPORTED'));

try {
  const cli = L.sessionCli(dir);
  const env = { ...cli.env };
  const g1 = await L.startGateway({ dir, port: 6534, label: 's7-1', env, rec });
  gateways.push(g1);
  const infLoop = await L.publishLoop(g1.call, inference('stored inference', 'STOREDINF', { model: 'gpt-6-luna', effort: 'max' }));
  const decLoop = await L.publishLoop(g1.call, decision('stored decision', 'STOREDDEC'));
  const controlLoop = await L.publishLoop(g1.call, inference('control luna max', 'STOREDCTL', { model: 'gpt-6-luna', effort: 'max' }));
  const ownerLoop = await L.publishLoop(g1.call, inference('stored owner default', 'STOREDOWNER', {}));
  const put = await g1.call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'max' } } } } });
  rec.log('created on this build (all valid: gpt-6-luna/max)', { infLoop, decLoop, controlLoop, ownerLoop, settingsPut: put.status });
  // Phase 1 needs valid owner defaults, so clear them for now; phase 2 restores them.
  await g1.call('/settings/defaults', { method: 'DELETE' });
  await g1.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('P0 first gateway drains to exit 0', (await g1.waitExit(30_000)) === 0, g1.exitCode());

  // ---------------- Phase 1: stored nodes ----------------
  const e1 = edit('nodes', infLoop, decLoop);
  rec.log('phase 1 store edit (stopped store)', e1);
  const g2 = await L.startGateway({ dir, port: 6534, label: 's7-2', env, rec });
  gateways.push(g2);
  const cat = (await g2.call('/model-catalog')).json.items.find((e) => e.harness === 'codex' && e.model === 'gpt-5.5');
  rec.check('P1 restart refreshes the harness seed: the stored gpt-5.5 row lists no max again', cat && !cat.efforts.includes('max'), cat?.efforts);
  const before1 = cli.requests().length;
  const o1 = await runAll(g2, cli, [
    ['inference gpt-5.5/max', infLoop, 'STOREDINF'],
    ['LLM decision gpt-5.5/max', decLoop, 'STOREDDEC'],
    ['control gpt-6-luna/max', controlLoop, 'STOREDCTL'],
  ]);
  rec.log('phase 1 outcomes', o1);
  rec.check('P1 stored inference gpt-5.5/max is refused with EFFORT_UNSUPPORTED', refusedUnsupported(o1['inference gpt-5.5/max']), o1['inference gpt-5.5/max'].failure ?? o1['inference gpt-5.5/max'].startBody);
  rec.check('P1 stored LLM decision gpt-5.5/max is refused with EFFORT_UNSUPPORTED', refusedUnsupported(o1['LLM decision gpt-5.5/max']), o1['LLM decision gpt-5.5/max'].failure ?? o1['LLM decision gpt-5.5/max'].startBody);
  rec.check('P1 neither refused run reached the CLI', o1['inference gpt-5.5/max'].requests.length === 0 && o1['LLM decision gpt-5.5/max'].requests.length === 0, null);
  rec.check('P1 control: gpt-6-luna/max still runs and sends max', o1['control gpt-6-luna/max'].status === 'succeeded' && JSON.stringify(o1['control gpt-6-luna/max'].requests) === JSON.stringify([{ model: 'gpt-6-luna', effort: 'max' }]), o1['control gpt-6-luna/max']);
  rec.check('P1 exactly one CLI request in phase 1 (the control)', cli.requests().length - before1 === 1, cli.requests().length - before1);
  await g2.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('P1 gateway drains to exit 0', (await g2.waitExit(30_000)) === 0, g2.exitCode());
  g2.copyLog('s7-gateway-2.log.txt');

  // ---------------- Phase 2: stored owner default ----------------
  // Restore the owner default through the API on a fresh start, then edit it while stopped.
  const g3 = await L.startGateway({ dir, port: 6534, label: 's7-3', env, rec });
  gateways.push(g3);
  rec.log('owner default restored', (await g3.call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'max' } } } } })).status);
  await g3.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  await g3.waitExit(30_000);
  const e2 = edit('settings');
  rec.log('phase 2 store edit (stopped store)', e2);
  const g4 = await L.startGateway({ dir, port: 6534, label: 's7-4', env, rec });
  gateways.push(g4);
  const settings = (await g4.call('/settings')).json;
  rec.log('owner Settings as stored after restart', settings?.defaults ?? settings);
  const before2 = cli.requests().length;
  const o2 = await runAll(g4, cli, [['inheriting node, owner default gpt-5.5/max', ownerLoop, 'STOREDOWNER']]);
  rec.log('phase 2 outcome', o2);
  const owner = o2['inheriting node, owner default gpt-5.5/max'];
  rec.check(
    'P2 a stored owner default gpt-5.5/max is refused before any request (EVALUATION_INVALID_CONFIGURATION naming the unsupported default effort)',
    owner.status === 'failed' && owner.failure?.code === 'EVALUATION_INVALID_CONFIGURATION' && /effort is not supported/i.test(owner.failure?.message ?? '') && cli.requests().length === before2,
    owner.failure,
  );
  rec.check('P2 the refusal carries the code EFFORT_UNSUPPORTED somewhere in the run record', JSON.stringify(owner.failure ?? {}).includes('EFFORT_UNSUPPORTED'), owner.failure);
  await g4.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('P2 gateway drains to exit 0', (await g4.waitExit(30_000)) === 0, g4.exitCode());
  g4.copyLog('s7-gateway-4.log.txt');
} catch (error) {
  rec.check('S7 completed without exception', false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) {
    if (x.exitCode() === null) {
      await x.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
      await x.waitExit(20_000);
    }
  }
  rec.finish();
  L.cleanupStore(dir, rec);
}
