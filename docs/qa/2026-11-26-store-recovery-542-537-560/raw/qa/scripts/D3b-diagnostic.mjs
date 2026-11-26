import { inspect } from 'node:util';
const locks = await import('file:///G:/ggq/gg-r542/GraphGoblin/apps/api/dist/data-dir-lock.js');
try { await locks.acquireDataDirLock(process.argv[2]); console.log(JSON.stringify({ acquired: true })); }
catch (e) {
  const f = e.cause;
  console.log(JSON.stringify({ message: e.message, cause: { operation: f?.operation, code: f?.code, probeFailures: f?.probeFailures?.map((p) => ({ operation: p.operation, code: p.code, causeMessage: p.cause?.message, causeEnumerable: Object.keys(p).includes('cause') })) } }, null, 1));
  console.log('--- default inspect depth shows:', /probeFailures: \[ \[Object\] \]/.test(inspect(e)) ? '[Object] (collapsed)' : 'expanded');
}
