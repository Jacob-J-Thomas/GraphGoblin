import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const directory = dirname(fileURLToPath(import.meta.url));
const work = resolve(directory, '../pr505-final-disposable-work-01');
const mode = process.argv[2];
const run = join(directory, mode);
const require = createRequire(join(work, 'packages/adapter-codex/package.json'));
const { createVitest } = await import(pathToFileURL(require.resolve('vitest/node')).href);
const folder = join(run,'input');
const opts = {root:folder, config:join(folder,'vitest.config.mjs'), watch:false, run:true, reporters:['verbose','json'], outputFile:{json:join(run,'vitest.json')}};
const ctx = await createVitest(opts);
const marker = join(run,'ready.json');
const events = join(run,'events.jsonl');
function readiness() {
  if (mode !== 'cancel-live') return existsSync(marker) ? JSON.parse(readFileSync(marker,'utf8')) : undefined;
  if (!existsSync(events)) return undefined;
  for (const line of readFileSync(events,'utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.event === 'fake-cli-spawn') return event;
  }
}
const begin = performance.now();
function record(name, obj={}) {
  appendFileSync(join(run,'controller.jsonl'), JSON.stringify({ name, elapsedMs:Math.round(performance.now()-begin), ...obj })+'\n');
}
try {
  const running = ctx.start();
  for (let i=0; !readiness() && i<600; i++) await wait(25);
  const marked = readiness();
  if (!marked) throw new Error('Controlled readiness marker did not appear');
  record('requested-cancellation', {reason:'keyboard-input', marker: marked});
  await ctx.cancelCurrentRun('keyboard-input');
  record('cancellation-returned');
  const result = await running;
  record('start-returned',{state:result?.state});
} finally {
  await ctx.close();
  record('instance-closed');
}
