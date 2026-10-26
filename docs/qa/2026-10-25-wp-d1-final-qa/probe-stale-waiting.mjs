// Outside-scope probe: does a parent that fails at its subloop node keep `waiting` on its record?
// Run: node --expose-gc probe-stale-waiting.mjs
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiStore, chain, eventually, exitNode, logger, makeDataDir, removeDir, scriptNode, subNode, writeJson } from './lib.mjs';
import { mcpSession } from './mcp-client.mjs';

const log = logger('probe-stale-waiting');
const dir = await makeDataDir('probe');
const store = apiStore({ dataDir: dir, port: Number(process.env.QA_PORT ?? 6395), log });
const out = {};
try {
  await store.start();
  const leaf = await store.publish(chain('Probe failing leaf', [scriptNode('work', ['-e', 'process.exit(3)'], { stdin: 'none', stdout: 'ignore' }), exitNode()]));
  const top = await store.publish(chain('Probe parent', [subNode(leaf), exitNode()]));
  const run = await store.startRun(top);
  await eventually(async () => (await store.run(run.id)).status === 'failed', 60_000, 'parent failed');
  const parent = await store.run(run.id);
  const [child] = await store.children(run.id);
  const mcp = await mcpSession(store.origin);
  const listed = await mcp.tool('list_runs', { loopId: top });
  await mcp.close();
  out.parent = { status: parent.status, waiting: parent.waiting ?? null, failure: parent.failure?.code, currentNodeId: parent.currentNodeId };
  out.child = { status: child.status, waiting: child.waiting ?? null };
  out.mcpSummary = listed.structured?.items?.find((r) => r.id === run.id);
  log(JSON.stringify(out));
} finally {
  await store.kill();
  writeJson('probe-stale-waiting.json', out);
  await removeDir(dir);
  log('removed', existsSync(dir) ? 'STILL PRESENT' : 'removed');
}
