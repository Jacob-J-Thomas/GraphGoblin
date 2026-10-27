// Diagnostic only (fake CLI, no provider): start the PR head on one port and call two routes,
// printing a fetch error's cause. Used to diagnose check 4 attempts 1 and 2 (port 6697).
//   node port-probe.mjs <port>
import * as L from './lib.mjs';

const dir = L.makeStore('probe');
const fake = L.fakeCli(dir);
const port = Number(process.argv[2]);
const g = await L.startGateway({ dir, port, label: 'probe', env: fake.env });
for (const p of ['/system/shutdown', '/harness/preflight']) {
  try {
    const r = await g.call(p);
    console.log(port, p, r.status, String(r.text).slice(0, 160));
  } catch (e) {
    console.log(port, p, 'ERR', String(e), String(e?.cause), e?.cause?.code);
  }
}
console.log(port, 'stop', await g.stop());
L.cleanupStore(dir);
