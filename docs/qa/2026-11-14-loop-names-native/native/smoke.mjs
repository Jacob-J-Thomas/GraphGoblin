import { startNative, api, approvalLoop, equivalent, QA } from './lib.mjs';
const g = await startNative({ port: 4791, dataDir: `${QA}/native/data-smoke`, label: 'smoke' });
try {
  console.log('pid', g.pid, g.url);
  const a = await api(g.url, 'POST', '/loops', { definition: approvalLoop('Smoke loop') });
  console.log(a.status, a.json?.loop?.id);
  const b = await api(g.url, 'POST', '/loops', { definition: approvalLoop(equivalent('Smoke loop')) });
  console.log(b.status, JSON.stringify(b.json));
  const c = await fetch(`${g.url}/app/loops`);
  console.log('app', c.status);
} finally {
  g.stop();
}
