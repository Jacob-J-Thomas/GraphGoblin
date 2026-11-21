export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;
// QA167I independent D167 behavior QA fixture. Not product code. Installed only as apps/api/dist/main.js
// inside a disposable fixture repository copy. Reaching it means the compiled launcher's ordinary
// gateway-start path ran (Gateway.Ensure -> NativeProcess.Start). It appends one driver-owned marker and
// exits with the distinctive natural code 54 without listening: never a ready gateway, never a store.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

let written = false;
try {
  appendFileSync(
    join(process.env.QA167I_CASE_DIR, 'gateway-markers.ndjson'),
    JSON.stringify({
      marker: 'QA167I-FIXTURE-GATEWAY-MAIN-REACHED',
      at: Date.now(),
      pid: process.pid,
      ppid: process.ppid,
      port: process.env.GG_PORT ?? null,
      logDirProvided: Boolean(process.env.GG_WINDOWS_LAUNCHER_LOG_DIR),
    }) + '\n',
  );
  written = true;
} catch {
  written = false;
}
process.exit(written ? 54 : 97);
