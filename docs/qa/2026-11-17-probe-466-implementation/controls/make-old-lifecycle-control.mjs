// Builds the negative control: the corrected probe test with the pre-#466 lifecycle substituted.
// Usage: node make-old-lifecycle-control.mjs <corrected test file> <output control test file>
import { readFileSync, writeFileSync } from 'node:fs';

const [source, output] = process.argv.slice(2);
let text = readFileSync(source, 'utf8');
const replace = (from, to) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected exactly one occurrence, found ${count}: ${from.slice(0, 80)}`);
  text = text.replace(from, to);
};

// Old lifecycle 1: the case body owns its own cleanup in `finally`; nothing waits for it after Vitest
// abandons the case, and no finish hook is registered (base 6d7fcc98 shape).
replace(
  `    const work = (async () => {
      root = await probeFs.mkdtemp(join(tmpdir(), prefix));
      await body({ signal: context.signal, root, children });
    })();
    context.onTestFinished(async () => {
      const [outcome] = await Promise.allSettled([work]);
      await Promise.all(
        children
          .filter(isRunning)
          .map((child) => new Promise((resolve) => child.once('exit', resolve))),
      );
      vi.unstubAllEnvs();
      if (root !== undefined) await probeFs.rm(root, { recursive: true, force: true });
      // A body that outlived the abort reports how it ended; otherwise the case reported it already.
      if (context.signal.aborted && outcome.status === 'rejected') throw outcome.reason;
    });
    return work;`,
  `    const work = (async () => {
      root = await probeFs.mkdtemp(join(tmpdir(), prefix));
      try {
        await body({ signal: context.signal, root, children });
      } finally {
        vi.unstubAllEnvs();
        await probeFs.rm(root, { recursive: true, force: true });
      }
    })();
    return work;`,
);
// Old lifecycle 2: the fake CLI runner neither refuses after an abort nor passes the case signal.
replace(`    probe.signal.throwIfAborted();\n`, '');
replace(
  `      timeout,
      probe.signal,
    );`,
  `      timeout,
    );`,
);
// Old lifecycle 3: the file-level environment reset that ran before any settlement.
replace(
  `import { describe, expect, it, vi, type TestContext } from 'vitest';`,
  `import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';`,
);
replace(`const TEMP_NAMES = ['TEMP', 'TMP', 'TMPDIR'];\n`, `const TEMP_NAMES = ['TEMP', 'TMP', 'TMPDIR'];\n\nafterEach(() => vi.unstubAllEnvs());\n`);
writeFileSync(output, text);
console.log(`wrote ${output}`);
