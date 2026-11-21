export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;
// QA459I independent #459 correction baseline QA fixture. Not product code. Installed only as
// apps/api/dist/main.js inside a disposable fixture repository copy. Reaching this script means the
// launcher's ordinary gateway-start path ran (Gateway.Ensure -> NativeProcess.Start). It appends one
// driver-owned marker record and exits with the distinctive natural code 54 without listening, so a
// fixture gateway never becomes ready and never touches any store. Marker write failure exits 97.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export const QA459I_GATEWAY_EXIT = 54;
let written = false;
try {
  appendFileSync(
    join(process.env.QA459I_CASE_DIR, 'gateway-markers.ndjson'),
    JSON.stringify({
      marker: 'QA459I-FIXTURE-GATEWAY-MAIN-REACHED',
      at: Date.now(),
      pid: process.pid,
      ppid: process.ppid,
      port: process.env.GG_PORT ?? null,
      dataDir: process.env.GG_DATA_DIR ?? null,
      logDirProvided: Boolean(process.env.GG_WINDOWS_LAUNCHER_LOG_DIR),
    }) + '\n',
  );
  written = true;
} catch {
  written = false;
}
process.exit(written ? QA459I_GATEWAY_EXIT : 97);
