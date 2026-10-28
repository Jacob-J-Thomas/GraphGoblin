// The review's storage fixtures (review-scripts/base-history.mjs, base-missing.mjs, sql-scope.mjs),
// adapted to this record's helpers and paths, against the hand-correction recipe as the CHANGELOG
// publishes it. The legacy rows are written by the base build itself (a4fee9a9, archived and
// transpiled under %TEMP%\gg-205-base, its own test-app composition with fake ports and a catalog
// widened to list minimal, as the review did), not planted by text replacement.
//
//   node scripts/reviewer-fixtures.mjs build                          transpile the archived base
//   node --import <base-loader URL> scripts/reviewer-fixtures.mjs base   write the two legacy stores
//   node scripts/reviewer-fixtures.mjs head                           find, correct, read back; scope
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as L from './lib.mjs';

// Output folder: round1 (default) or the round named by ROUND (for example ROUND=round2).
const ROUND = process.env.ROUND ?? 'round1';

const phase = process.argv[2];
const scratch = path.join(os.tmpdir(), 'gg-205-base');
const base = path.join(scratch, 'base');
const stateFile = path.join(scratch, 'state.json');

function changelogRecipe() {
  const lines = fs.readFileSync(path.join(L.ROOT, 'CHANGELOG.md'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith('- Effort `none` (no reasoning)'));
  const open = lines.indexOf('  ```sql', at);
  const close = lines.indexOf('  ```', open + 1);
  const text = lines.slice(open + 1, close).map((l) => l.replace(/^ {2}/, '')).join('\n');
  const find = text.split('-- 2.')[0].replace(/^--.*\n/, '').trim().replace(/;$/, '');
  const correct = '-- 2.' + text.split('-- 2.')[1];
  return { find, correct };
}

if (phase === 'build') {
  const require = createRequire(path.join(L.ROOT, 'package.json'));
  const ts = require('typescript');
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  let count = 0;
  for (const top of ['packages', 'apps'])
    for (const name of fs.readdirSync(path.join(base, top))) {
      const pkg = path.join(base, top, name);
      const src = path.join(pkg, 'src');
      if (!fs.existsSync(src)) continue;
      for (const file of walk(src)) {
        if (/\.d\.ts$/.test(file)) continue;
        const dest = path.join(pkg, 'dist', path.relative(src, file)).replace(/\.tsx?$/, '.js');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (/\.tsx?$/.test(file)) {
          const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true },
          });
          fs.writeFileSync(dest, out.outputText);
          count++;
        } else fs.copyFileSync(file, dest);
      }
    }
  const loader = `import {registerHooks} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=${JSON.stringify(L.ROOT)},base=${JSON.stringify(base)};
registerHooks({resolve(s,c,n){
 if(c.parentURL?.startsWith(pathToFileURL(base).href)){
  if(s.startsWith('@graphgoblin/')){
   const [,name,...rest]=s.split('/');let pkg;for(const top of ['packages','apps']){const p=path.join(base,top,name,'package.json');if(fs.existsSync(p)){pkg=p;break;}}
   if(pkg){const exp=JSON.parse(fs.readFileSync(pkg,'utf8')).exports;let t=exp[rest.length?'./'+rest.join('/'):'.'];if(typeof t==='object')t=t.import??t.default;if(typeof t==='object')t=t.default;return {url:pathToFileURL(path.resolve(path.dirname(pkg),t)).href,shortCircuit:true};}
  }
  if(!s.startsWith('.')&&!s.startsWith('/')&&!s.startsWith('file:')&&!s.startsWith('node:'))return n(s,{...c,parentURL:pathToFileURL(path.join(root,path.relative(base,fileURLToPath(c.parentURL)))).href});
 }return n(s,c);
}});
`;
  fs.writeFileSync(path.join(scratch, 'base-loader.mjs'), loader);
  console.log(JSON.stringify({ base: 'a4fee9a9', transpiled: count, loader: path.join(scratch, 'base-loader.mjs') }));
} else if (phase === 'base') {
  const rec = new L.Recorder(`${ROUND}/reviewer-base`);
  const { createTestApp } = await import(pathToFileURL(path.join(base, 'apps/api/dist/testing/test-app.js')).href);
  const make = async (name) => {
    const store = L.makeStore(name);
    const t = await createTestApp({
      tempPrefix: `gg-205-${name}-helper-`,
      env: { GG_DATA_DIR: store, GG_DB_URL: 'file:' + path.join(store, 'graphgoblin.db').replaceAll('\\', '/') },
    });
    const luna = await t.container.repos.catalog.findOne('codex', 'gpt-6-luna');
    await t.container.repos.catalog.upsert({ ...luna, efforts: ['minimal', ...luna.efforts] });
    return { store, t };
  };
  const state = {};
  // base-history.mjs: an owner default and a node at minimal; one successful fake turn.
  {
    const { store, t } = await make('rev-history');
    try {
      const settings = await t.app.inject({ method: 'PUT', url: '/settings', payload: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'minimal' } } } } });
      const loopId = await t.publishLoop(L.single('Review base historical minimal', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'minimal' })));
      const start = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: { input: null } });
      await t.idle();
      const runId = start.json().run.id;
      const events = (await t.app.inject(`/runs/${runId}/events`)).json().items;
      rec.check('base history: the base build stores a run whose owner default and session are at minimal', settings.statusCode === 200 && (await t.app.inject(`/runs/${runId}`)).json().status === 'succeeded' && events.some((e) => e.type === 'harness.session' && e.effort === 'minimal'), { types: events.map((e) => e.type) });
      state.history = { store, loopId, runId };
    } finally {
      await t.close();
    }
  }
  // base-missing.mjs: a removed provider session recorded at minimal.
  {
    const { store, t } = await make('rev-missing');
    try {
      t.harness.script([{ items: [] }, { announceSession: false, accepted: false, submission: 'session-missing', items: [], error: { code: 'HARNESS_SESSION_MISSING', message: 'Controlled missing session' } }]);
      const first = L.inferenceNode('first', { model: 'gpt-6-luna', effort: 'minimal' });
      const second = L.inferenceNode('second', { model: 'gpt-6-luna', effort: 'minimal' });
      second.config.session = { policy: 'resume-previous' };
      const loopId = await t.publishLoop(L.loop('Base missing session', [first, second], [L.edge('e1', 'start', 'first'), L.edge('e2', 'first', 'second'), L.edge('e3', 'second', 'done')]));
      const start = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: { input: null } });
      await t.idle();
      const runId = start.json().run.id;
      const run = (await t.app.inject(`/runs/${runId}`)).json();
      rec.check('base missing: the base build stores missing-session evidence at minimal', run.failure?.missingSession?.effort === 'minimal', run.failure);
      state.missing = { store, loopId, runId };
    } finally {
      await t.close();
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  rec.finish(state);
} else if (phase === 'head') {
  const rec = new L.Recorder(`${ROUND}/reviewer-head`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const { find, correct } = changelogRecipe();
  rec.log('recipe read from the CHANGELOG', { findCharacters: find.length, correctCharacters: correct.length });
  const gateways = [];
  try {
    let port = 6301;
    for (const [name, { store, runId }] of Object.entries(state)) {
      const found = await L.withDb(store, async (db) => (await db.execute(find)).rows.map((r) => `${r.place} ${r.ref}`));
      await L.withDb(store, async (db) => db.executeMultiple(correct));
      const left = await L.withDb(store, async (db) => (await db.execute(find)).rows.length);
      const remaining = await L.withDb(store, async (db) => ({
        events: (await db.execute({ sql: `SELECT seq, type FROM run_events WHERE run_id = ? AND payload LIKE '%"minimal"%'`, args: [runId] })).rows.map((r) => `${r.seq} ${r.type}`),
        sessions: (await db.execute({ sql: 'SELECT effort FROM harness_sessions WHERE run_id = ?', args: [runId] })).rows.map((r) => r.effort),
        failure: (await db.execute({ sql: `SELECT json_extract(failure, '$.missingSession.effort') AS e FROM runs WHERE id = ?`, args: [runId] })).rows[0]?.e ?? null,
      }));
      const g = await L.startGateway({ dir: store, port: port++, label: `reviewer-${name}`, rec });
      gateways.push(g);
      const reads = {};
      if (g.failedStart === undefined)
        for (const route of [`/runs/${runId}`, `/runs/${runId}/events?after=0&limit=1000`, `/runs/${runId}/thread`]) reads[route.split('?')[0]] = (await g.call(route)).status;
      rec.check(
        `${name}: the CHANGELOG SELECT lists the base-written rows; after its statements the SELECT is empty, no minimal is left in the run's events or sessions, and run, events and thread read 200`,
        found.length > 0 && left === 0 && remaining.events.length === 0 && remaining.sessions.every((e) => e !== 'minimal') && remaining.failure !== 'minimal' && g.failedStart === undefined && Object.values(reads).every((s) => s === 200),
        { found, left, remaining, reads, startup: g.failedStart === undefined ? 'listening' : g.failedStart },
      );
      await g.stop();
      g.copyLog(`${ROUND}/reviewer-${name}-gateway.log.txt`);
    }
    // sql-scope.mjs: authored JSON that names effort minimal outside a typed path.
    const { createTestApp } = await import(pathToFileURL(path.join(L.ROOT, 'apps/api/dist/testing/test-app.js')).href);
    const store = L.makeStore('rev-scope');
    const t = await createTestApp({ tempPrefix: 'gg-205-rev-scope-helper-', env: { GG_DATA_DIR: store, GG_DB_URL: 'file:' + path.join(store, 'graphgoblin.db').replaceAll('\\', '/') } });
    let versionId;
    try {
      const definition = { ...L.single('Authored variable default', L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'none' })), variables: { payload: { type: 'object', default: { effort: 'minimal' } } } };
      const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
      versionId = created.json().draft.id;
    } finally {
      await t.close();
    }
    const scope = await L.withDb(store, async (db) => {
      const read = async () => (await db.execute({ sql: 'SELECT definition FROM loop_versions WHERE id = ?', args: [versionId] })).rows[0].definition;
      const before = await read();
      const found = (await db.execute(find)).rows.length;
      await db.executeMultiple(correct);
      return { found, unchanged: (await read()) === before, variables: JSON.parse(await read()).variables };
    });
    rec.check('scope: the authored variable default {effort:minimal} is neither listed nor changed (byte for byte)', scope.found === 0 && scope.unchanged, scope);
  } catch (error) {
    rec.check('reviewer fixtures completed without exception', false, String(error?.stack ?? error));
  } finally {
    for (const x of gateways) if (x.exitCode() === null) await x.stop();
    rec.finish();
  }
} else throw new Error('usage: reviewer-fixtures.mjs build|base|head');
