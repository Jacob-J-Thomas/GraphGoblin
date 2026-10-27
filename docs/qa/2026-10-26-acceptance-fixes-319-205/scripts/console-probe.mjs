// Mechanism probe for #319 D-1, outside GraphGoblin. A host process owns a console the way a
// terminal window does; a Node "gateway" attached to it starts two children the way the product
// does: one hidden with piped stdio (ProcessScripts, the Claude runner) and one piped without
// windowsHide (the Codex SDK 0.160.0 spawn). One real CTRL_C_EVENT is then delivered to that console.
//
// Usage: node console-probe.mjs <console-tool.exe> <scratch dir> <log file>
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [tool, scratch, log] = process.argv.slice(2);
writeFileSync(log, '');
const note = (line) => appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
const gateway = join(scratch, 'probe-gateway.cjs');
writeFileSync(
  gateway,
  `const { spawn } = require('node:child_process');
const say = (m) => process.stdout.write(m + '\\n');
process.on('SIGINT', () => say('gateway SIGINT handled'));
const hold = ['-e', 'setTimeout(() => {}, 20000)'];
const hidden = spawn(process.execPath, hold, { stdio: 'pipe', windowsHide: true });
const plain = spawn(process.execPath, hold, { stdio: 'pipe' });
say('children hidden=' + hidden.pid + ' plain=' + plain.pid);
hidden.on('exit', (c) => say('hidden child exit code=' + c));
plain.on('exit', (c) => say('plain child exit code=' + c));
setTimeout(() => { say('gateway done'); process.exit(0); }, 8000);
`,
);
note(`node ${process.version}`);
const host = spawn(tool, ['host', scratch, `"${process.execPath}" "${gateway}"`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
host.stdout.on('data', (chunk) => {
  output += chunk;
  for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) note(`gateway: ${line}`);
});
host.stderr.on('data', (chunk) => note(`host: ${String(chunk).trim()}`));
while (!output.includes('children')) await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, 500));
const sent = spawnSync(tool, ['ctrlc', String(host.pid)], { windowsHide: true });
note(`ctrlc to the host console: exit ${sent.status} ${String(sent.stderr).trim()}`);
const code = await new Promise((r) => host.once('exit', r));
note(`host exit ${code}`);
