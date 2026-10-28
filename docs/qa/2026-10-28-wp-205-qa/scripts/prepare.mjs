// Independent QA preparation. Copies evidence helpers, never product files or tests.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const out=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(out,'../../..');
let lib=fs.readFileSync(path.join(root,'docs/qa/2026-10-28-wp-205-none/scripts/lib.mjs'),'utf8');
lib=lib.replaceAll('gg-205-','gg-qa205-').replaceAll('6300','6370').replaceAll('6309','6379');
lib=lib.replace('startGateway({ dir, port, env = {}, label, rec })','startGateway({ dir, port, env = {}, label, rec, root = ROOT, loader })');
lib=lib.replace("[path.join(ROOT, 'apps', 'api', 'dist', 'main.js')]", "[...(loader ? ['--experimental-loader', loader] : []), path.join(root, 'apps', 'api', 'dist', 'main.js')]");
lib=lib.replace('cwd: ROOT,','cwd: root,');
// Native termination is deliberately not used as a fallback: shutdown is a public API action.
lib=lib.replace('endPid(pid);', "rec?.observe('D-015: not observable here; gateway did not drain', { pid });");
fs.writeFileSync(path.join(out,'scripts/lib.mjs'),lib);
const tools=fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa205-tools-'));
fs.mkdirSync(path.join(tools,'fake'));
let cs=fs.readFileSync(path.join(root,'docs/qa/2026-10-27-pr426-qa-final/scripts/fake-cli.cs.txt'),'utf8');
cs=cs.replace('var mode = Mode(dir, claude);','var mode = Mode(dir, claude);\n    File.AppendAllText(Path.Combine(dir, "argv.jsonl"), "[" + string.Join(",", Array.ConvertAll(args, Q)) + "]" + Environment.NewLine);');
fs.writeFileSync(path.join(out,'scripts/fake-cli.cs.txt'),cs);
fs.writeFileSync(path.join(tools,'fake-cli.cs'),cs);
const main=fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa205-main-src-'));
fs.writeFileSync(path.join(os.tmpdir(),'gg-qa205-state.json'),JSON.stringify({tools,main}));
console.log('Prepared own QA helpers and fake CLI source; no product edits.');
