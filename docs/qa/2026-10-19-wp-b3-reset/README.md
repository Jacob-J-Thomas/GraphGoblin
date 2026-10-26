# Explicit reset and current-format refusals: owner QA (#266, #188)

WP-B3 replaces pre-1.0 conversion with clear refusals and an explicit reset ([ADR-0042](../../decisions/ADR-0042-explicit-resets-replace-conversion.md), [reset guide](../../guide/08-offline-upgrade.md)). This folder holds the owner's manual check and a summary of the automated evidence behind it.

- `seed-format3-store.mjs` is QA tooling, not product code. It builds a disposable data directory holding a format-3 store, so the refusals and the reset have something real to act on. Nothing in the build, the tests or the gates imports it.
- The steps below were run on 2026-10-19 on the WP-B3 branch after merging `main` at `e10b5d2`, with Node 22.14.0 on Windows 11. Step 11 was run by script in Edge, using the same snippet. The outputs shown are what that run printed; `<temp>` stands for `$env:TEMP`.

## Owner QA steps

Use a PowerShell window in the branch checkout. Every step uses disposable directories under `$env:TEMP` and port 5650, so the running instance on 4747 and its store in `~/.graphgoblin` are not touched. Set `GG_DATA_DIR` in this window before anything else: the reset acts on the configured data directory, and with `GG_DATA_DIR` unset that is `~/.graphgoblin`.

1. Build on Node 22.

   ```powershell
   $env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
   pnpm.cmd install --frozen-lockfile
   pnpm.cmd build
   ```

2. Point this window at disposable directories.

   ```powershell
   $env:GG_DATA_DIR = "$env:TEMP\gg-qa-266"
   $env:GG_PORT = '5650'
   ```

3. Seed a format-3 store. The seed also adds one run with its workspace and artifacts, a user folder `workspaces\my-notes`, a `master.key`, and a junction from the run workspace to an outside folder that must survive.

   ```powershell
   node docs/qa/2026-10-19-wp-b3-reset/seed-format3-store.mjs . $env:GG_DATA_DIR "$env:TEMP\gg-qa-266-outside"
   ```

   Expected: `seeded a format-3 store in <temp>\gg-qa-266`.

4. Start the API with `node apps/api/dist/main.js`. Expected: exit code 1, no stack trace, and this message:

   ```text
   GraphGoblin did not start: this build cannot open the store in data directory <temp>\gg-qa-266.
     Database: <temp>\gg-qa-266\graphgoblin.db
     Found:    format 3
     Requires: format 4
     Reason:   The store is format 3; this build reads only format 4
   No stored data was changed. This build does not convert stores from other formats.
   To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):
     node apps/api/dist/main.js --reset --data-dir "<temp>\gg-qa-266"
   ```

5. Run `node apps/api/dist/main.js --preflight`. Expected: exit code 1, with a failed database line: `FAIL Database The store is format 3; this build reads only format 4. Start refuses this store and converts nothing; to start fresh, list what a reset removes with node apps/api/dist/main.js --reset --data-dir "<temp>\gg-qa-266"`.

6. Run the dry run, `node apps/api/dist/main.js --reset --data-dir $env:GG_DATA_DIR`. Expected: exit code 0, and every file in the data directory is byte-for-byte unchanged (hash the files before and after if you like). It prints this manifest; the sizes can differ slightly:

   ```text
   GraphGoblin reset (dry run: nothing is removed)

   Data directory: <temp>\gg-qa-266
   Database:       <temp>\gg-qa-266\graphgoblin.db (format 3; this build requires format 4)

   Removes:
     workspaces/01JQA266RUNAAAAAAAAAAAAAAA  run workspace            1 file, 2 directories, 1 link, 10 B
     artifacts                              artifacts                1 file, 2 directories, 13 B
     graphgoblin.db                         database                 1 file, 4.0 KB
     graphgoblin.db-wal                     SQLite write-ahead log   1 file, 285.7 KB
     graphgoblin.db-shm                     SQLite shared memory     1 file, 32.0 KB
     graphgoblin.lock                       the reset's own lock     removed last, on release

   Keeps:
     master.key                             secret-store key; kept so the secrets in a backup of this store stay readable
     workspaces/my-notes                    not a stored run ID
     Browser device drafts stay in each browser; discard them from the loop editor.

   Total removed: 5 files, 4 directories, 1 link, 321.7 KB in 5 items.

   Nothing was removed. To reset, stop every GraphGoblin process using this data directory and run:
     node apps/api/dist/main.js --reset --yes --data-dir "<temp>\gg-qa-266"
   ```

7. Check that a wrong command is refused.
   - `node apps/api/dist/main.js --reset --yes` exits with code 2. It prints `--yes needs --data-dir <path> naming the data directory to reset` and the usage line.
   - `node apps/api/dist/main.js --reset --yes --data-dir C:\Windows` exits with code 1. It prints `reset refused: --data-dir names C:\Windows, but this environment's data directory is <temp>\gg-qa-266 (GG_DATA_DIR, or ~/.graphgoblin when it is unset); run the reset with the environment that serves that directory`, then `Nothing was changed.`

8. Run the confirmed reset, `node apps/api/dist/main.js --reset --yes --data-dir $env:GG_DATA_DIR`. Expected: exit code 0. The output prints the manifest again (without the dry-run lines) and ends:

   ```text
   Removing:
     removed workspaces/01JQA266RUNAAAAAAAAAAAAAAA (1 file, 2 directories, 1 link, 10 B)
     removed artifacts (1 file, 2 directories, 13 B)
     removed graphgoblin.db (1 file, 4.0 KB)
     removed graphgoblin.db-wal (1 file, 285.7 KB)
     removed graphgoblin.db-shm (1 file, 32.0 KB)
     removed graphgoblin.lock
   Reset complete. The next start creates a new, empty format-4 store in <temp>\gg-qa-266.
   ```

   Afterwards the data directory holds only `master.key`, `workspaces\my-notes\keep.txt` and the now-empty `workspaces` folder. `Get-Content "$env:TEMP\gg-qa-266-outside\src\precious.txt"` still prints `must survive the reset`, because the reset removed the junction without following it.

9. Start the server with `node apps/api/dist/main.js` and leave it running. Expected: <http://127.0.0.1:5650/app/> opens on an empty, fresh store. In a second window, set the same `GG_DATA_DIR` and run `node apps/api/dist/main.js --reset --yes --data-dir $env:GG_DATA_DIR`. Expected: exit code 1, with `reset refused: another GraphGoblin process holds <temp>\gg-qa-266\graphgoblin.lock; stop it before resetting` and then `Nothing was changed.`

10. Import an older export. In the app, import a file containing `{"format":"graphgoblin-loop","formatVersion":3,"exportedAt":"x","loop":{}}`, or post it to `http://127.0.0.1:5650/loops/import`. Expected: `400` with code `LOOP_FORMAT_UNSUPPORTED`, the detail `This loop export is format 3; this build reads only format 4 and does not convert other formats. Re-create the loop in this build, or export it again from a build that writes format 4.`, and `errors` `{"foundFormat":3,"requiredFormat":4}`. The app shows that detail in an alert, and the loop list stays empty.

11. Plant an older device draft.
    1. Create a loop in the app and copy its ID from the editor URL (`/app/loops/<id>/edit`).
    2. Go back to `/app/loops`, open the DevTools console, and run the snippet below.

       ```js
       const loopId = '<id>';
       const db = await new Promise((ok, fail) => {
         const r = indexedDB.open('graphgoblin', 2);
         r.onupgradeneeded = () => r.result.createObjectStore('drafts');
         r.onsuccess = () => ok(r.result);
         r.onerror = () => fail(r.error);
       });
       await new Promise((ok, fail) => {
         const t = db.transaction('drafts', 'readwrite');
         t.objectStore('drafts').put(
           {
             loopId,
             definition: { schemaVersion: 3, name: 'old' },
             savedAt: '2026-01-01T00:00:00.000Z',
             synced: false,
           },
           loopId,
         );
         t.oncomplete = ok;
         t.onerror = () => fail(t.error);
       });
       db.close();
       ```

    3. Open the loop's editor. Expected: an **Unsupported device draft (format 3)** notice with **Export this device draft** and **Discard this device draft**, and the editor stays closed. Export downloads the stored record unchanged, and **Discard this device draft** opens the editor on the server draft.
    4. Repeat with `definition: { schemaVersion: 3, name: 'old' },` removed from the record. Expected: the notice reads **Unsupported device draft (an unknown format)** and both actions still work.

12. Stop the server with Ctrl+C, then delete `$env:TEMP\gg-qa-266` and `$env:TEMP\gg-qa-266-outside`. If `GG_JEV_API_KEY` is set in your environment, the fresh store in step 9 seeded it into its secrets, and deleting the folder removes it.

## Automated evidence

- **Real-filesystem reset tests**: `apps/api/src/reset/reset.test.ts` and `store-facts.test.ts`. They run against real temporary directories, with junctions on Windows.
  - Argument parsing and usage (exit code 2).
  - Byte-identical dry runs of current, older, unreadable and absent stores, and the bounded manifest with its full totals.
  - A confirmed reset that removes exactly the manifest, keeps `master.key`, user folders and everything unrecognised, removes links themselves and refuses a link swapped in after listing when the removal check observes it (the remaining external-process race is described below).
  - A partial failure that reports what was removed and what was left, followed by a rerun that finishes.
  - Every refusal leaves a stale lock and every other byte in place. The refusals covered:
    - a database reached through a link;
    - a database inside `artifacts/`;
    - a database outside the data directory;
    - a database that is not a file;
    - a wrong `--data-dir`;
    - invalid configuration;
    - a lock held by another process.
  - A database in a subdirectory, and a data directory that is itself a link.
  - Store facts are read from a private copy in a child process, with a timeout, so the store is never opened in place.
- **Startup refusal and guard**:
  - `apps/api/src/container.test.ts` checks the full startup message for an older store and for a damaged format-4 store. It also checks that the refusal comes before any master key is created or migration applied.
  - `packages/infrastructure/src/sqlite/store-format.test.ts`, `readiness.test.ts` and `fresh-initialization.test.ts` cover the guard: marker, format, unfinished status, ledger and structure.
- **Edge spec** `apps/web/e2e/device-draft-format.spec.ts`:
  - A format-3 device draft is refused across a reload. The stored record stays unchanged and no draft is sent to the server.
  - Only **Discard this device draft** removes it, and the editor then opens on the server draft.
  - A record with no definition or a `null` definition still renders both actions, and its export equals the stored record.
  - The unit tests in `apps/web/src/editor/EditorPage.restore.test.tsx` cover the export of a format-3 copy. `apps/web/src/loops/LoopsPage.test.tsx` covers the import alert.
- **`pnpm test:reset`** (`tooling/scripts/reset.acceptance.mjs`, run in CI after Build) drives the built binary in the same order as the steps above:
  - startup refusal text and exit code;
  - a dry run that leaves the tree byte-for-byte unchanged;
  - refusal of a wrong target;
  - a confirmed reset that keeps `master.key`, the user folder and the outside folder behind a link;
  - a fresh start that answers `/healthz`.

## Removal identity regression check (2026-10-25)

At PR #355 head `32568edd3756207d7790bf771b5bd7e7746c2303`, native Windows filesystem tests in `apps/api/src/reset/tree.test.ts` and `reset-identity.test.ts` reproduced same-kind file deletion and a root junction pivot into an unrelated store. All fixtures use system-temp `gg-wp-b3-rid-*` directories. Junctions on Windows become directory symbolic links on other platforms. No provider or owner-store evidence is claimed.

The fresh confirmed plan under the data-directory lock now records each entry's identity and the identities of every physical directory on its route: the root first, then every ancestor, including kept folders containing a configured nested database. Immediately before every removal, bigint `lstat` and the shared volume-root/device/file-index identity construction recheck all of those directories and the entry itself. A moved, replaced or newly linked path stops through `ResetIncompleteError`, naming the entry and what changed, with completed, partial and remaining targets. Replacements and outside bytes stay intact; a rerun plans what remains again. Links in an unchanged plan are removed as links.

Node offers no handle-relative removal. The checks narrow but cannot eliminate a race with an external process changing the tree between the check and `unlink`/`rmdir`. The data-directory lock prevents GraphGoblin itself from changing the tree concurrently.

Baseline command (Node v22.23.4): `pnpm --filter @graphgoblin/api exec vitest run src/reset/tree.test.ts src/reset/reset-identity.test.ts`. Result: **9 failed, 1 passed**. Failure evidence, before production changes:

| Case                                                             | Failure on `32568edd`                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component: same-kind database replacement                        | `expected undefined to be an instance of Error`; `expected 'missing' to be 'replacement bytes'`                                                                                                                                                            |
| Component: root replaced by a directory                          | `expected 'missing' to be 'replacement bytes'`                                                                                                                                                                                                             |
| Component: root replaced by a junction                           | `expected 'missing' to be 'outside bytes'`                                                                                                                                                                                                                 |
| Component: kept ancestor replaced by a directory                 | `expected 'missing' to be 'replacement bytes'`                                                                                                                                                                                                             |
| Component: kept ancestor replaced by a junction                  | Expected entry-specific `ancestor database is now a link` diagnostic; received `Error: database is no longer a physical directory`. The baseline already refused this case and preserved its bytes; this failure establishes the improved diagnostic only. |
| Component: planned directory replaced by another empty directory | Replacement-directory existence: `expected false to be true`                                                                                                                                                                                               |
| Public CLI: database replacement at `Removing:`                  | `expected +0 to be 1`; `expected 'missing' to be 'replacement database'`                                                                                                                                                                                   |
| Public CLI: root junction pivot at `Removing:`                   | `expected +0 to be 1`; `expected 'missing' to be 'outside database'`                                                                                                                                                                                       |
| Public CLI: kept ancestor replaced after `removed artifacts`     | `expected +0 to be 1`; both replacement database and WAL were `missing`                                                                                                                                                                                    |

The unchanged-tree component control passed on the baseline, including link removal and preservation of the outside file. The public-boundary regressions assert stdout, stderr, exit status, replacement/outside bytes and (where restored) successful reruns. `pnpm test:reset` remains the ordinary built CLI process control for dry run, wrong target, reset and fresh start. Existing lock, stale-lock, refusal, partial-failure and master-key controls remain in `reset.test.ts`.
