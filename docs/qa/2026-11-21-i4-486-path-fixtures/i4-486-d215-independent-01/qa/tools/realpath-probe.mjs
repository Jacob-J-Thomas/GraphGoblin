// Read-only residual probe: does JS fs.realpathSync agree with native realpath (the production
// primitive behind fs/promises.realpath) for (a) every TEMP observed in this QA's children and
// (b) an existing 8.3 short-name spelling on this host? Creates nothing; writes one G record.
import fs from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

const RAW =
  'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d215-independent-01\\qa\\raw';
const observed = [];
for (const name of fs.readdirSync(RAW).filter((n) => n.endsWith('.child.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(RAW, name), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.kind !== 'process' || !/forks\.js$/i.test(r.argv?.[0] ?? '')) continue;
    observed.push({
      log: name,
      tmpdir: r.tmpdir,
      js: r.tmpdirRealpathJs,
      native: r.tmpdirRealpathNative,
      agree: r.tmpdirRealpathJs === r.tmpdirRealpathNative,
    });
  }
}
const probe = async (p) => {
  const out = { input: p };
  for (const [k, fn] of [
    ['jsRealpathSync', () => fs.realpathSync(p)],
    ['nativeRealpathSync', () => fs.realpathSync.native(p)],
  ]) {
    try {
      out[k] = fn();
    } catch (e) {
      out[k] = { error: e.code };
    }
  }
  try {
    out.promisesRealpathProductionPrimitive = await realpath(p);
  } catch (e) {
    out.promisesRealpathProductionPrimitive = { error: e.code };
  }
  out.jsEqualsProductionPrimitive = out.jsRealpathSync === out.promisesRealpathProductionPrimitive;
  out.nativeEqualsProductionPrimitive =
    out.nativeRealpathSync === out.promisesRealpathProductionPrimitive;
  return out;
};
const rec = {
  at: new Date().toISOString(),
  node: process.version,
  scenarioWorkerTempRealpathAgreement: observed,
  allScenarioWorkersAgree: observed.every((o) => o.agree),
  shortNameProbe: await probe('C:\\PROGRA~1'),
  longNameControl: await probe('C:\\Program Files'),
};
fs.writeFileSync(path.join(RAW, '60-residual-realpath-probe.json'), JSON.stringify(rec, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify(rec, null, 1));
