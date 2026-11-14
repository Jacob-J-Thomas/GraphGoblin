import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const evidence = dirname(fileURLToPath(import.meta.url));
const worktree = await realpath(process.argv[2]);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();
if (head !== 'b3b5e1874a8252cc01c065d18fef42cbfbe075b4') throw new Error('Unexpected baseline '+head);
const store = await mkdtemp(join(evidence, 'disposable-store-'));
for (const key of Object.keys(process.env)) {
  if (/^GG_/i.test(key) || /^(JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(key)) delete process.env[key];
}
Object.assign(process.env, { GG_PORT:'0', GG_HOST:'127.0.0.1', GG_DATA_DIR:store,
  GG_OLLAMA_ENABLED:'false', GG_WEB_DIST:join(worktree,'apps','web','dist'),
  GG_GOBLIN_DIST:join(worktree,'apps','web','dist-goblin'), GG_LOG_LEVEL:'warn' });
const { main } = await import(pathToFileURL(join(worktree, 'apps','api','dist','main.js')));
const { app } = await main();
const address = app.server.address();
if (!address || typeof address !== 'object' || [4747,4748].includes(address.port)) throw new Error('Unsafe bound port');
const origin = 'http://127.0.0.1:' + address.port;
const health = await fetch(origin + '/healthz');
if (!health.ok || health.headers.get('x-graphgoblin-pid') !== String(process.pid)) throw new Error('readiness failed');
const manifests = {};
for (const path of ['/app/','/goblin/']) {
  const response = await fetch(origin+path);
  if (!response.ok) throw new Error('built shell unavailable '+path);
  manifests[path] = [...(await response.text()).matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match)=>match[1]);
}
const record = { worktree, head, store, origin, pid:process.pid, node:process.version, manifests };
await writeFile(join(evidence,'gateway.json'), JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify(record));
