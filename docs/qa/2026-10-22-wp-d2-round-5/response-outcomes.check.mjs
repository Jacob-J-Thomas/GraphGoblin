import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
const [directory, scenario] = process.argv.slice(2);
const results = async () =>
  JSON.parse(await readFile(join(directory, 'native-results.json'), 'utf8'));
if (scenario === '600') {
  const final = await readFile(join(directory, 'http-600-final.json'), 'utf8').catch(
    () => undefined,
  );
  const result = final
    ? JSON.parse(final)
    : (await results()).find((row) => row.name === 'HTTP 600');
  assert.equal(result.delivery.status, 'failed', 'HTTP 600 must have a bounded final outcome');
  assert.equal(result.delivery.attempts, 5);
  assert.equal(result.requests, 5);
  assert.equal(result.finalized, true);
  assert.equal(result.delivery.lastError.code, 'transport');
  assert.equal(result.delivery.lastError.acknowledgement, 'unknown');
  assert.equal(result.delivery.lastError.httpStatus, undefined);
} else {
  assert.equal(scenario, 'uncertainty');
  const result = (await results()).find((row) => row.name === 'uncertainty inspector');
  assert.equal(
    result.warningVisible,
    true,
    'Successful delivery must retain the earlier uncertainty warning',
  );
}
