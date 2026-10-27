import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as L from './lib.mjs';
const mode = process.argv[2] ?? 'regression';
const commands = mode === 'acceptance' ? [
  ['wait-restart', 'pnpm.cmd test:wait-restart'],
  ['prompt-restart', 'pnpm.cmd test:prompt-restart'],
  ['missing-session', 'pnpm.cmd --filter @graphgoblin/api exec node --test scripts/missing-session.integration.mjs'],
] : mode === 'performance' ? [['throughput', `node ${L.RECORD}/throughput.mjs`]] :
  (mode === 'audit' ? ['child-races','snapshot-cost','failure-projection-race','failure-projection-native','atomic-definition','script-replay'] : mode === 'regression' ? ['behaviour', 'lineage', 'restarts', 'races', 'final-probes', 'force-http', 'build-baseline', 'upgrade'] : [mode])
    .map((name) => [name, `node "${path.join(L.RECORD, name + '.mjs')}"`]);
const results = [];
for (const [name, command] of commands) {
  const env = { ...process.env,
    GG_TEST_PORT_START: '6970',
    GG_TEST_PORT_COUNT: '30',
    GG_TEST_STORE_PREFIX: 'gg-qa-422f-wait-',
    GG_PROMPT_RESTART_PORT_BASE: '6660', GG_PROMPT_RESTART_DATA_PREFIX: 'gg-qa-422f-prompt-',
    GG_265_RESTART_PORT: '6660', GG_265_EVIDENCE_DIR: L.RECORD, GG_TEST_DATA_PREFIX: 'gg-qa-422f-missing-',
  };
  // Maintained API tests use the requested 6970 + 30 pool. Other fixtures use 6660-6669.
  env.NODE_OPTIONS = '--import=' + pathToFileURL(path.join(L.RECORD, 'retain-directories.mjs')).href;
  console.log('BEGIN ' + name + ' ' + new Date().toISOString());
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', '& ' + command], {
    cwd: L.REPO, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (b) => {
    output += b.toString(); process.stdout.write(L.redact(b.toString()));
  });
  const [code, signal] = await new Promise((resolve) => child.on('exit', (...a) => resolve(a)));
  L.save(name + '-console.log.txt', '$ ' + command + '\n' + output + '\nEXIT ' + code + ' ' + signal);
  results.push({ name, command, pid: child.pid, code, signal });
  L.save('batch-' + mode + '.json', results);
  console.log('END ' + name + ' exit=' + code);
}
process.exitCode = results.some((r) => r.code !== 0) ? 1 : 0;
