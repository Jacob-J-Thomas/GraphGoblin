import { command, save, assert, head } from './qa-lib.mjs';
const result = await command(
  'pnpm.cmd --filter @graphgoblin/engine exec vitest run src/unlimited.test.ts --maxWorkers=1 --reporter=verbose',
);
result.head = head;
await save('engine-focused-results.json', result);
console.log(result.output);
assert.equal(result.exitCode, 0);
