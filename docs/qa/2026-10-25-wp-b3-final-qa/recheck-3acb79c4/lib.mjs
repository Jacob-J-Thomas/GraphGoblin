// QA tooling for the targeted re-check of D3 on 3acb79c4, not product code. It reuses the
// dca4272b re-check helpers (which reuse the original record's ../lib.mjs) and writes its logs into
// this folder.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Log as BaseLog, sanitize } from '../recheck-dca4272b/lib.mjs';

export * from '../recheck-dca4272b/lib.mjs';

export const RECHECK_DIR = dirname(fileURLToPath(import.meta.url));

/** The original Log, saving into this folder. */
export class Log extends BaseLog {
  save() {
    this.line('');
    this.line(`SUMMARY ${this.name}: ${this.passes} passed, ${this.failures.length} failed`);
    for (const failure of this.failures) this.line(`  FAILED: ${failure}`);
    writeFileSync(join(RECHECK_DIR, `${this.name}.log.txt`), sanitize(this.lines.join('\n')) + '\n');
  }
}
