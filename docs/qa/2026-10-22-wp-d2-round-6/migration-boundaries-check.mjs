import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const out = process.env.GG_AUDIT_D2_OUT ?? join(process.env.TEMP, 'gg-audit-d2-round2-20261022');
const evidence = JSON.parse(await readFile(join(out, 'migration-boundaries.json'), 'utf8'));
const failures = [];
for (const c of evidence.cases) {
  try {
    if (c.oldValid) {
      assert.equal(c.after.type, 'delivery.finished', 'A valid historical receipt must convert');
      assert.equal(
        c.newValid,
        true,
        'The converted historical receipt must satisfy the current contract',
      );
    } else {
      assert.deepEqual(
        c.after,
        c.before,
        'An invalid historical receipt must remain byte-identical',
      );
    }
  } catch (error) {
    failures.push({ name: c.name, message: error.message.split('\n')[0] });
  }
}
const result = {
  checked: evidence.cases.length,
  passed: evidence.cases.length - failures.length,
  failures,
};
await writeFile(join(out, 'migration-boundaries-check.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.equal(failures.length, 0, 'Historical receipt conversion must preserve every invalid row');
