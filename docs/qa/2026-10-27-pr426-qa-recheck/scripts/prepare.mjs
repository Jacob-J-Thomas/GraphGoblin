// Reuse the first QA's public-interface drivers, with this re-check's isolation rules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.dirname(here);
const previous = path.resolve(out, '../2026-10-27-pr426-qa/scripts');
for (const name of ['lib.mjs', 'c1-catalog.mjs', 'c1-upgrade.mjs', 'c4-regression.mjs', 'fake-cli.cs.txt']) {
  let source = fs.readFileSync(path.join(previous, name), 'utf8');
  source = source.replaceAll('gg-qa-426-', 'gg-qa-426r-');
  for (let n=6690; n<=6699; n++) source = source.replaceAll(String(n), String(n+20));
  if (name === 'lib.mjs') {
    source = source.replace("import { fileURLToPath } from 'node:url';", "import { fileURLToPath, pathToFileURL } from 'node:url';");
    source = source.replace("  if (port === 6717) throw new Error('port 6717 is a fetch-blocked port');", '');
    const start = source.indexOf('export function cleanupStore(');
    const end = source.indexOf('export async function launchEdge', start);
    source = source.slice(0,start) + `export function cleanupStore(dir, rec) { rec?.log('disposable store retained; no deletion attempted', dir); }\n\n` + source.slice(end);
    source = source.replace("[path.join(root, 'apps', 'api', 'dist', 'main.js')]", "[...(root === MAIN_ROOT ? ['--experimental-loader', pathToFileURL(path.join(OUT, 'scripts', 'baseline-loader.mjs')).href] : []), path.join(root, 'apps', 'api', 'dist', 'main.js')]");
    source = source.replace('  assertPort(port);', `  assertPort(port);\n  if (!env.GG_CODEX_BINARY || !env.GG_CLAUDE_BINARY) throw new Error('QA gateway requires both fake CLIs');`);
    source = source.replace('  started.add(pid);', `  started.add(pid);\n  fs.appendFileSync(path.join(OUT, 'pids.log.txt'), JSON.stringify({pid, label, port, dir: redact(dir)}) + '\\n');`);
    source = source.replace('    exitCode = code ?? signal;', `    exitCode = code ?? signal;\n    fs.appendFileSync(path.join(OUT, 'exits.log.txt'), JSON.stringify({pid: child.pid, label, exitCode}) + '\\n');`);
  }
  if (name === 'c1-upgrade.mjs') {
    source = source.replace('const watch = L.startArgvWatch(g1);', 'const watch = {stop: async () => []}; // fake-CLI request ledger is the provider-call evidence; no process inventory watcher');
    source = source.replace("    const dRec", "    const dRec");
    source = source.replace("JSON.stringify(dRec.failure).includes('EFFORT_UNSUPPORTED')", "dRec.failure?.details?.code === 'EFFORT_UNSUPPORTED'");
  }
  if (name === 'fake-cli.cs.txt') {
    source = source.replace('    string body = null;', `    if (mode == "parse") {\n      Out("{\\"type\\":\\"error\\",\\"message\\":\\"An earlier generic diagnostic\\"}");\n      Out("MALFORMED_PROTOCOL_ITEM");\n      return 0;\n    }\n    string body = null;\n    if (mode == "invalid-value") body = ProviderBody(400, "invalid_request_error", null, "Error: invalid value for reasoning.effort: 'minimal'.", "reasoning.effort");\n    if (mode == "missing-thread-text") body = ProviderBody(400, "invalid_request_error", null, "Thread not found in referenced input.", "reasoning.effort");`);
  }
  fs.writeFileSync(path.join(here,name),source);
}
const tools = path.join(os.tmpdir(),'gg-qa-426r-tools');
fs.mkdirSync(path.join(tools,'fake'),{recursive:true});
fs.copyFileSync(path.join(here,'fake-cli.cs.txt'), path.join(tools,'fake-cli.cs'));
console.log(JSON.stringify({tools,node:process.version,executable:process.execPath}));
