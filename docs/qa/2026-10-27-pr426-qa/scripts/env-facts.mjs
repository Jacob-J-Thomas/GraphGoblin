// Environment facts for the record: Node, Edge (as Playwright launches it), the Codex CLI the product
// runs (the SDK-bundled binary, --version only; no provider call) and the build copies.
//   node env-facts.mjs <PR head sha> <which node>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const [head, whichNode] = process.argv.slice(2);
const bundled = path.join(L.PR_ROOT, 'node_modules', '.pnpm', '@openai+codex@0.160.0-win32-x64', 'node_modules', '@openai', 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const browser = await L.launchEdge();
const facts = {
  prHead: head,
  nodeVersion: process.version,
  nodeExecPath: process.execPath,
  whichNode,
  os: `${os.type()} ${os.release()}`,
  edge: `Microsoft Edge ${browser.version()} (Playwright channel msedge, headless)`,
  codexBundled: {
    path: bundled,
    version: execFileSync(bundled, ['--version'], { windowsHide: true }).toString().trim(),
    bytes: fs.statSync(bundled).size,
    sha256: createHash('sha256').update(fs.readFileSync(bundled)).digest('hex'),
  },
  codexInstalledOnPath: execFileSync('cmd.exe', ['/c', 'codex', '--version'], { windowsHide: true }).toString().trim(),
  mainCopy: L.MAIN_ROOT,
};
await browser.close();
fs.writeFileSync(path.join(L.OUT, 'env.log.txt'), L.redact(JSON.stringify(facts, null, 2)) + '\n');
process.stdout.write(L.redact(JSON.stringify(facts, null, 2)) + '\n');
