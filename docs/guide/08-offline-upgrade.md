# Reset and fresh start

This build reads only the current format, format 4: its data store, loop exports and browser device drafts. Anything older is refused clearly and never converted ([ADR-0042](../decisions/ADR-0042-explicit-resets-replace-conversion.md)). The way forward is an explicit **reset** of the data directory, run by you, which lists exactly what it removes before it removes anything.

The offline `graphgoblin-upgrade` tool and the automatic conversion of old imports and device drafts were retired on 2026-10-18. Builds up to `cfae696` still include them, if you need to bring an old export forward once (this page keeps its old file name so older links land here).

## When GraphGoblin refuses to start

Startup checks the store before it writes anything. A store this build cannot open stops startup with exit code 1 and an explanation, for example:

```text
GraphGoblin did not start: this build cannot open the store in data directory C:\Users\you\.graphgoblin.
  Database: C:\Users\you\.graphgoblin\graphgoblin.db
  Found:    format 3
  Requires: format 4
  Reason:   The store is format 3; this build reads only format 4
No stored data was changed. This build does not convert stores from other formats.
To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):
  node apps/api/dist/main.js --reset --data-dir "C:\Users\you\.graphgoblin"
```

`Found` is `format N` for an older store, `no valid format marker` for a store written before format markers existed (or with a damaged marker), and `format 4, but the store is damaged or unfinished` when a format-4 store fails a structure, ledger or data check; `Reason` names the check. No stored data is changed in any case (SQLite may refresh its `-shm` index file while reading). `node apps/api/dist/main.js --preflight` reports the same store as a failed **Database** check.

A damaged format-4 store can be repaired by hand if you know what broke (the reason names the table or check). Otherwise, reset it.

## What a reset removes and keeps

A reset removes, inside the data directory only:

- the run workspaces under `workspaces/` whose names are run IDs stored in the database (read when the database can be read; otherwise every workspace is kept);
- `artifacts/`;
- the database file and its SQLite sidecars (`-wal`, `-shm`, `-journal`);
- the lock file, last, when the reset releases it.

It keeps `master.key` (the secret-store key: a backup of the database stays readable with it, and the next store reuses it), every other entry, and anything under `workspaces/` that is not a stored run ID. Entries identified as symbolic links or junctions are removed as links themselves. Immediately before removal the reset checks the planned identities of the physical root, every ancestor and the entry. These checks protect referenced repositories, working directories and harness installations, subject to Node's remaining race: it offers no handle-relative removal, so an external process can still change the tree between a check and removal. The lock prevents concurrent GraphGoblin changes. Browser device drafts live in each browser; see [Old device drafts](#old-device-drafts-in-a-browser).

An inspectable special file (socket, FIFO or device) inside a removed directory is unlinked, a special file at the root is kept, and a special file configured as the database is refused. Some entries cannot be inspected without following them on a particular system: Windows AF_UNIX socket files, for example, make Node's `lstat` return access denied. Both the dry run and confirmed reset then refuse, naming the path and changing no data-directory byte. Stop the program using it, check its permissions, and move or remove that entry yourself before running the reset again. The reset never guesses its identity or removes it blindly.

A reset cannot be undone. If you might want the data later, stop GraphGoblin and copy the whole data directory somewhere safe first.

## List what a reset would remove

Stop every GraphGoblin process that uses the data directory (the API, `pnpm start`, a service or container). Then, from the checkout, with the same environment the server uses (`GG_DATA_DIR`, `GG_DB_URL`):

```powershell
node apps/api/dist/main.js --reset --data-dir "C:\Users\you\.graphgoblin"
```

This dry run reads and prints; it changes no byte in the data directory. It does not open the database with SQLite, which would rewrite its sidecar files: the format marker and run IDs are read from a temporary copy. `--data-dir` is optional here; when given it must name the configured data directory. The independent reader owns that copy and removes it after its SQLite worker exits; it also monitors whether the reset CLI is still alive. If both processes are terminated before cleanup, the next valid reset also cleans stale private copies in the system temp directory. It only removes its exact dedicated prefix plus valid ownership metadata and matching directory identity, after both recorded owners are provably dead and no unexpected entries are present. Similar names, unmarked or malformed directories, links and live or uncertain owners are left alone. No age-based temp cleanup is performed. A private-copy cleanup failure refuses the reset with the named directory to check. Sample output:

```text
GraphGoblin reset (dry run: nothing is removed)

Data directory: C:\Users\you\.graphgoblin
Database:       C:\Users\you\.graphgoblin\graphgoblin.db (format 3; this build requires format 4)

Removes:
  workspaces/01JRESETACCEPTANCEAAAAAAAA  run workspace            1 file, 2 directories, 1 link, 10 B
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
  node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

Each section lists at most 20 rows and summarises the rest; the totals always cover everything. A dry run refuses while another process holds the data-directory lock.

## Reset

Run the command the dry run printed:

```powershell
node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

`--yes` alone is refused: the confirmation must name the data directory, and it must be the one this environment configures (`GG_DATA_DIR`, or `~/.graphgoblin` when it is unset), so a different shell cannot reset another store by accident. The reset takes the data-directory lock (it refuses while GraphGoblin is running), lists the same manifest again, removes exactly those items, prints each one, and ends with `Reset complete.` It refuses, changing nothing, when the database is outside the data directory, is not a local file (for example `:memory:`), is reached through a link, is not a regular file, or lies inside `artifacts/` or `workspaces/`.

If something goes wrong part of the way (for example another program holds a file open), the reset stops, releases its lock and reports exactly what it removed, what it removed partly (with counts) and what it did not remove. Do not start GraphGoblin on that directory until the reset finishes: fix the cause and run the same command again; it lists and removes what is left.

Exit codes: 0 done (or nothing to reset), 1 refused or stopped, 2 a mistyped command line (nothing is read or changed).

In the container image, stop the service and run the same command in a one-off container, for example `docker compose run --rm graphgoblin node apps/api/dist/main.js --reset --data-dir /data`.

## Start fresh

Start GraphGoblin as usual. On an empty data directory it creates a new format-4 store in one transaction: the schema, its migration ledger and the format marker. Then re-create or import your loops (current-format exports import as before), set secrets again if the store held them, and re-arm triggers.

## Old exports

`POST /loops/import` and the web import refuse a document that declares another format with `400 LOOP_FORMAT_UNSUPPORTED`, for example:

```json
{
  "code": "LOOP_FORMAT_UNSUPPORTED",
  "detail": "This loop export is format 3; this build reads only format 4 and does not convert other formats. Re-create the loop in this build, or export it again from a build that writes format 4.",
  "errors": { "foundFormat": 3, "requiredFormat": 4 }
}
```

Nothing is saved. Re-create the loop, or convert the file once with an older build that still has the converter (`graphgoblin-upgrade export` in builds up to `cfae696`) and import its format-4 output.

## Old device drafts in a browser

The loop editor never converts, loads or overwrites a device draft from an older build. It lists it as **Unsupported device draft (format N)**, saying which loop and which copy it is (an unsaved draft, a set-aside draft or an archived copy) and when it was saved. While such a copy is the browser's unsaved or set-aside draft, editing and autosave are paused so it cannot be overwritten. **Export this device draft** downloads the stored record unchanged; **Discard this device draft** removes only that copy from this browser (the loop on the server and other browsers are unchanged), and the editor then opens normally. An old archived copy does not pause editing.

## Check the reset end to end

After `pnpm build`, `pnpm test:reset` runs the built API binary against a temporary data directory: startup refuses an older store with the message above, the dry run changes no byte, a confirmation naming another directory is refused, the confirmed reset removes exactly its manifest without following a link, and the next start creates a fresh store. It touches no installed instance.
