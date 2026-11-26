// Temporary mutation check: each mutant must make at least one focused test fail.
// Restores every source file byte-for-byte afterwards.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'G:/ggq/gg-r542/GraphGoblin';
const lock = join(root, 'apps/api/src/data-dir-lock.ts');
const container = join(root, 'apps/api/src/container.ts');
const failures = 'src/data-dir-lock-failures.test.ts';
const cleanup = 'src/container-startup-cleanup.test.ts';

const mutants = [
  ['marker recheck dropped', lock, "      !matchesMarker(await lstat(marker, { bigint: true }))\n", '      false\n', failures],
  ['final directory identity dropped', lock, '      samePhysicalEntry(directory, finalDirectory)\n', '      true\n', failures],
  ['staged consistency dropped', lock, '!before || !samePhysicalEntry(staged, before)', '!before', failures],
  ['capture stability dropped', lock, 'after && samePhysicalEntry(before, after) ? after', 'after ? after', failures],
  ['capture sole-marker check dropped', lock, "if (names.length !== 1 || names[0] !== name) return undefined;", '', failures],
  ['release successor verification removed', lock, "removed && own\n", "false && own\n", failures],
  ['release verification without own marker removal', lock, "removed && own\n", "own\n", failures],
  ['identity proof ignored', lock, ': !samePhysicalEntry(proof, current))', ': false)', failures],
  ['record proof ignored', lock, "? (await readFile(path, 'utf8')) !== proof", '? false', failures],
  ['reservation always dropped', lock, 'if (settled) heldPaths.delete(path);', 'heldPaths.delete(path);', failures],
  ['second close reintroduced', lock, "    await file.close(); // The only close, whatever happened before it.\n", "    await file.close(); // The only close, whatever happened before it.\n    if (primary) await file.close().catch(() => undefined);\n", failures],
  ['identity probe failure unreported', lock, "      report?.(probeFailure('successor-identity', current.reason, 'UNKNOWN'));\n", '      void 0;\n', failures],
  ['marker read label removed', lock, "    throw filesystemFailure(error, 'observed-marker-read', path);", '    throw error;', failures],
  ['own marker read label removed', lock, "throw filesystemFailure(error, 'recovery-marker-read', marker);", 'throw error;', failures],
  ['guard release failure not carried', lock, "        cleanup.push(cleanupStep('recovery-release', error));\n", '        void error;\n', failures],
  ['leases released after unconfirmed close', container, '  if (!closed) {\n', '  if (false) {\n', cleanup],
  ['read-only close primary flag ignored', container, "      cleanup.push(cleanupStep('readonly-database-close', setup.readonlyClose.failure));", '      void 0;', cleanup],
  ['database lease failure suppresses directory release', container, "      retained.push({ resource: 'database-lease', path: databaseLock.file });\n    });", "      retained.push({ resource: 'database-lease', path: databaseLock.file });\n      throw error;\n    });", cleanup],
];

const env = {
  ...process.env,
  PATH: `${process.env.USERPROFILE}\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64;${process.env.PATH}`,
  TEMP: 'G:\\ggq\\tmp\\a4-542-537-560',
  TMP: 'G:\\ggq\\tmp\\a4-542-537-560',
};
const originals = new Map([lock, container].map((file) => [file, readFileSync(file)]));
const results = [];
try {
  for (const [name, file, from, to, test] of mutants) {
    const source = originals.get(file).toString('utf8');
    const count = source.split(from).length - 1;
    if (count !== 1) {
      results.push({ name, outcome: `NOT APPLIED (${count} matches)` });
      continue;
    }
    writeFileSync(file, source.replace(from, to));
    let outcome;
    try {
      execFileSync('pnpm.cmd', ['--filter', '@graphgoblin/api', 'test', test], {
        cwd: root,
        env,
        stdio: 'pipe',
        shell: true,
        timeout: 300_000,
      });
      outcome = 'SURVIVED';
    } catch (error) {
      const text = String(error.stdout ?? '') + String(error.stderr ?? '');
      const failed = /Tests\s+(\d+) failed/.exec(text)?.[1];
      outcome = failed ? `killed (${failed} failing)` : `killed (no count: ${text.slice(-300)})`;
    } finally {
      writeFileSync(file, originals.get(file));
    }
    results.push({ name, outcome });
    console.log(name, '->', outcome);
  }
} finally {
  for (const [file, bytes] of originals) writeFileSync(file, bytes);
}
console.log(JSON.stringify(results, null, 2));
