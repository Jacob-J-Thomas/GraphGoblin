// Native worker is the shipped recipe with only the disposable TEMP prefix changed.
import { command, save, assert, head } from './qa-lib.mjs';
const result = await command('node docs/qa/2026-10-22-wp-f3-qa/round-3/native-worker.mjs');
result.head = head;
result.passedScenarios = [...result.output.matchAll(/PASS (\w+)/g)].map((x) => x[1]);
await save('native-recipe-results.json', result);
console.log(result.output);
assert.equal(result.exitCode, 0);
assert.deepEqual(result.passedScenarios, ['success', 'stall', 'quota', 'transport', 'unknown']);
