import { readFile, writeFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
let s = await readFile(new URL('merge-ui.mjs', here), 'utf8');
const old =
  "document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));";
const fixed =
  "document.dispatchEvent(new Event('visibilitychange',{bubbles:true}));Reflect.deleteProperty(document,'visibilityState');document.dispatchEvent(new Event('visibilitychange',{bubbles:true}));";
if (s.split(old).length !== 2) throw Error('Expected one visibility setup');
s = s.replace(old, fixed);
s = s
  .replaceAll("'merge-results.json'", "'background-results.json'")
  .replaceAll("'merge-timings.json'", "'background-timings.json'")
  .replaceAll("'merge-api.log.txt'", "'background-api.log.txt'")
  .replaceAll("'merge-lifecycle.json'", "'background-lifecycle.json'");
s = s.replace(
  'const heldReady=await snapshot();release();',
  "const heldReady=await snapshot();heldReady.capture=await capture('background-ready');release();",
);
s = s.replace(
  'const heldFailed=await snapshot();release();',
  "const heldFailed=await snapshot();heldFailed.capture=await capture('background-failed-retry');release();",
);
await writeFile(new URL('background-ui.mjs', here), s);
await writeFile(
  new URL('background-setup-correction.json', here),
  JSON.stringify(
    {
      originalResults: 'merge-results.json',
      failedCases: ['background-recheck-1440', 'background-recheck-390'],
      originalWaitMs: 5000,
      observed:
        'One initial readiness request; no second request or response, so background behavior was never entered.',
      cause: 'Synthetic document visibilitychange events did not bubble to the window listener.',
      before: old,
      after: fixed,
      scope:
        'Two focused checks with corrected external-event setup; original failed observations retained. Not a served replay rerun; no timeout or product edit.',
    },
    null,
    2,
  ) + '\n',
);
