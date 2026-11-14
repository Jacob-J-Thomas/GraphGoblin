import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const worktree = await realpath(process.argv[2]);
const expected = process.argv[3];
const bound = JSON.parse(await readFile(process.argv[4],'utf8'));
const evidence = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(worktree, evidence).startsWith('..'));
const git = (...args) => execFileSync('git', args, {
  cwd: worktree, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
}).trim();
const identity = () => ({ head: git('rev-parse','HEAD'), tree: git('rev-parse','HEAD^{tree}'),
  base:git('rev-parse','origin/main'),status: git('status','--porcelain=v1') });
const start = identity();
assert.equal(expected,bound.head);
assert.equal(start.head,bound.head);
assert.equal(start.tree,bound.tree);
assert.equal(start.base,bound.base);
assert.equal(start.status,'');
assert.equal(bound.mapping?.id,'273-review-correction-independent-v1');
const scratch = await mkdtemp(join(evidence,'gateway-store-'));
const dist = join(worktree,'apps','web','dist');
const apiEntry = join(worktree,'apps','api','dist','main.js');
const sourceFields = Object.keys(bound.sourceReadback);
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function sourceReadback() {
  return Object.fromEntries(await Promise.all(sourceFields.map(async (file)=>
    [file, digest(await readFile(join(worktree,file)))])));
}
const sourceHashes = await sourceReadback();
assert.deepEqual(sourceHashes,bound.sourceReadback);
const buildFiles = ['index.html', ...(await readdir(join(dist,'assets'))).filter(f => /\.(?:css|js)$/.test(f)).map(f => 'assets/'+f)];
const buildHashes = Object.fromEntries(await Promise.all(buildFiles.map(async f => [f, digest(await readFile(join(dist,f)))])));
const apiEntryHash = digest(await readFile(apiEntry));
assert.equal(apiEntryHash,bound.critical['apps/api/dist/main.js']);
for (const [file,hash] of Object.entries(buildHashes)) assert.equal(hash,bound.critical['apps/web/dist/'+file],file);
assert(buildHashes[bound.bundle.replace('/app/','')],'Frozen browser entry missing');
for (const k of Object.keys(process.env)) {
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: dist, GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
  GG_LOG_LEVEL: 'error',
  GG_CODEX_BINARY: join(scratch, 'no-codex-provider.exe'),
  GG_CLAUDE_BINARY: join(scratch, 'no-claude-provider.exe'),
  CODEX_HOME: join(scratch, 'empty-codex-home'),
  CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
});
await mkdir(scratch, { recursive:true });
const { main } = await import(pathToFileURL(apiEntry).href);
const { app } = await main();
try {
  const address = app.server.address();
  assert.equal(address.address,'127.0.0.1');
  assert(![4747,4748].includes(address.port));
  const url = 'http://127.0.0.1:' + address.port;
  const healthy = await fetch(url+'/healthz');
  assert.equal(healthy.headers.get('x-graphgoblin-pid'),String(process.pid));
  assert.equal(healthy.ok, true);
  const served = {};
  for (const [file, expectedDigest] of Object.entries(buildHashes)) {
    const response = await fetch(url+'/app/'+(file==='index.html'?'':file));
    assert.equal(response.ok, true);
    const actual = digest(Buffer.from(await response.arrayBuffer()));
    assert.equal(actual,expectedDigest);
    served[file] = actual;
  }
  const startRecord = { head:bound.head,tree:bound.tree,base:bound.base,evidenceMode:'clean corrected source',
    currentWorkingSourceBound:true,scratch,url,pid:process.pid,node:process.version,sourceHashes,
    buildHashes,served,apiEntryHash,bundle:bound.bundle };
  await writeFile(join(evidence,'gateway.json'),JSON.stringify(startRecord,null,2)+'\n');
  const domain = await import(pathToFileURL(join(worktree,'packages','domain','dist','index.js')).href);
  const chatDefinition = domain.enableChatAudio(
    domain.createSystemChatDefinition({ name:'Gateway chat', harness:'codex' }),
    { id:'chat-normalize',kind:'script',label:'Fixture only',ui:{x:160,y:-130},
      config:{command:process.execPath,args:['-p','JSON.stringify({text:"fixture only"})'],
        cwd:'workspace',stdin:'thread',stdout:'last-output'} },
  );
  const chat=(await (await fetch(url+'/loops')).json()).items.find((loop)=>loop.system?.audience?.kind==='gateway');
  assert(chat?.id,'Expected a disposable gateway system Chat');
  const current=await (await fetch(url+'/loops/'+chat.id)).json();
  assert(current.draftToken && current.current);
  const staged=await fetch(url+'/loops/'+chat.id+'/draft',{
    method:'PUT',headers:{'content-type':'application/json','if-match':'"'+current.draftToken+'"'},
    body:JSON.stringify({definition:chatDefinition}),
  });
  assert.equal(staged.status,200,await staged.clone().text());
  const chatDraft=await staged.json();
  await writeFile(join(evidence,'chat-seed.json'),JSON.stringify({loopId:chat.id,stagedToken:chatDraft.draftToken,
    stagedDefinition:chatDraft.draft.definition},null,2)+'\n');
  console.log('GG_QA_READY '+url);
  await new Promise((done) => {
    process.stdin.on('data', () => { process.stdin.pause(); done(); });
    process.stdin.once('end',done);
    process.stdin.resume();
  });
} finally {
  await app.close();
  const after = identity();
  const hashesAfter = await sourceReadback();
  assert.deepEqual(after,start);
  assert.deepEqual(hashesAfter,sourceHashes);
  await writeFile(join(evidence,'gateway-closed.json'),JSON.stringify({ ...after, pid:process.pid, listening:app.server.listening, scratch },null,2)+'\n');
}
