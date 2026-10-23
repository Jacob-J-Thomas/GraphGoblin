import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('.', import.meta.url);
const original = new URL('../round-3/served-checks.mjs', here);
let source = await readFile(original, 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
const edits = [];
function edit(before, after) {
  if (source.split(before).length !== 2)
    throw Error('Expected exactly one observation insertion target: ' + before.slice(0, 70));
  source = source.replace(before, after);
  edits.push({ before, after });
}
edit(
  'const sleep = (ms)',
  `let activeCheck = 'environment';
const observations = [], caseTimes = [], allLogs = [], starts = new WeakMap();
function observe(p) {
  p.on('request', r => starts.set(r,{case:activeCheck,utc:new Date().toISOString()}));
  p.on('requestfinished', async r => {
    const initial=starts.get(r), response=await r.response();
    observations.push({...initial,source:'Edge',method:r.method(),path:new URL(r.url()).pathname,status:response?.status(),timing:r.timing()});
  });
  p.on('requestfailed', r => observations.push({...starts.get(r),source:'Edge',method:r.method(),path:new URL(r.url()).pathname,failure:r.failure(),timing:r.timing()}));
}
const sleep = (ms)`,
);
edit(
  "server.stdout.on('data', (x) => (log += x));",
  "server.stdout.on('data', (x) => { log += x; allLogs.push(String(x)); });",
);
edit(
  "server.stderr.on('data', (x) => (log += x));",
  "server.stderr.on('data', (x) => { log += x; allLogs.push(String(x)); });",
);
edit(
  '  const r = await fetch(base + path, {',
  '  const began = performance.now(), caseId=activeCheck, utc=new Date().toISOString();\n  const r = await fetch(base + path, {',
);
edit(
  '  return { status: r.status, body: await r.json() };',
  "  const body=await r.json();\n  observations.push({case:caseId,utc,source:'Node fetch',method,path,status:r.status,durationMs:performance.now()-began});\n  return { status: r.status, body };",
);
edit('  page.setDefaultTimeout(15000);', '  observe(page);\n  page.setDefaultTimeout(15000);');
edit(
  "  try {\n    await api('/settings', 'PUT', {",
  "  activeCheck=id;\n  const caseStart=performance.now(), startedUtc=new Date().toISOString();\n  try {\n    await api('/settings', 'PUT', {",
);
edit(
  '}\nconst failure =',
  "  caseTimes.push({id,startedUtc,elapsedMs:performance.now()-caseStart,assertionDefaultMs:5000,pageDefaultMs:15000});\n  await writeFile(join(evidence,'served-timings.json'),sanitize(JSON.stringify({caseTimes,requests:observations},null,2))+String.fromCharCode(10));\n}\nconst failure =",
);
edit(
  "  await writeFile(join(dir, 'api.log'), log);",
  "  await writeFile(join(dir, 'api.log'), log);\n  await writeFile(join(evidence,'served-api.log.txt'),sanitize(allLogs.join('')));\n  await writeFile(join(evidence,'served-timings.json'),sanitize(JSON.stringify({caseTimes,requests:observations},null,2))+String.fromCharCode(10));",
);
await writeFile(new URL('observed-served-checks.mjs', here), source);
await writeFile(
  new URL('served-observation-edits.json', here),
  JSON.stringify(
    {
      original: '../round-3/served-checks.mjs',
      originalSha256: hash,
      method:
        'Exact committed source with observation insertions only. No case body, assertion, retry, timeout, route or fixture edits.',
      edits,
    },
    null,
    2,
  ) + '\n',
);
console.log('Created evidence-only observed replay; ' + edits.length + ' observation insertions.');
