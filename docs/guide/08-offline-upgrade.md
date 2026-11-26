# Reset and fresh start

This build reads only the current format, format 4: its data store, loop exports and browser device drafts. Anything older is refused clearly and never converted ([ADR-0042](../decisions/ADR-0042-explicit-resets-replace-conversion.md)). The way forward is an explicit **reset** of the data directory, run by you, which lists exactly what it removes before it removes anything.

The offline `graphgoblin-upgrade` tool and the automatic conversion of old imports and device drafts were retired on 2026-10-18. Builds up to `cfae696` still include them, if you need to bring an old export forward once (this page keeps its old file name so older links land here).

A change in which file the default configuration selects for a format-4 store is not a format change and is never fixed by a reset; see [Same-format upgrade: default database location](#same-format-upgrade-default-database-location).

## Same-format upgrade: default database location

This applies when `GG_DB_URL` is unset and the data directory path contains `%`, as in a shell start (`node apps/api/dist/main.js` or `pnpm start`) with such a `GG_DATA_DIR`. The store stays format 4; nothing is converted or rewritten, and a reset is not the fix. This build uses an explicit `GG_DB_URL` exactly as given.

Earlier builds put the data directory path into the default database URL without escaping it, and SQLite decodes percent escapes in that URL. With `GG_DATA_DIR='/example/active %41'`, an earlier build therefore kept its database at `/example/active A/graphgoblin.db`, while `master.key`, `artifacts/` and the rest of the store were in `/example/active %41`. This build escapes the path, so the same setting selects `/example/active %41/graphgoblin.db`. Only this percent-escape case is described here. If the path contains another character with a meaning in URLs, such as `#` or `?`, also confirm where the earlier database is before starting this build.

Startup does not look for the earlier file. If the newly selected file is absent, this build creates an empty format-4 database in the data directory, beside the original `master.key`: loops, runs and secrets seem to be gone, and new work is written to the new file while the earlier database stays as it was. If both files already exist, the new default selects the literal path's file. This path correction does not remove the earlier database.

### Before the first start of this build

1. Find the earlier database from evidence, never by guessing a nearby path: the database file the earlier gateway has open, a configuration or record you kept that names the physical file, or a backup and known stored content confirming which file that gateway used. A file merely existing at the decoded path is not enough. This build's `node apps/api/dist/main.js --preflight`, run with the server's environment, checks the selected local database without creating a missing one. It also probes directory writability and configured harnesses; it is not a zero-side-effect command. If its **Master key** check is `ok` but **Database** says the database does not exist yet, the selected path is missing; this does not identify or validate the earlier database.
2. [Stop the gateway safely](01-install-and-first-run.md#stop-and-restart-safely) and confirm its process has exited. Do not copy a database that a gateway still has open.
3. [Back up](06-settings-and-secrets.md#back-up-and-restore) the whole data directory, including `master.key` and `artifacts/`, and the earlier database together with any `-wal` and `-shm` files beside it. Its secrets are readable only with that `master.key`, so keep them together. Do not delete or rename sidecar or lock files. When asking for help, share paths and check results, never `master.key`, `GG_MASTER_KEY` or API keys.

If this build has already started and there are two databases, stop every gateway that uses either file and back up both databases with their sidecars, as well as the data directory. Decide which store you mean to keep using before starting again. GraphGoblin has no tool to merge them; work recorded in the other file stays only there, so keep its backup.

### Keep using the earlier database from a shell

Keep `GG_DATA_DIR` as it was, so `master.key`, `artifacts/` and workspaces are still found there, and set `GG_DB_URL` to a `file:` URL for the verified earlier database. This build uses an explicit `GG_DB_URL` verbatim and decodes it as SQLite does, so the URL must be escaped. Let Node build it from the absolute path, passed as one quoted argument, rather than escaping it by hand:

```bash
export GG_DATA_DIR='/example/active %41'
GG_DB_URL="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' '/example/active A/graphgoblin.db')"
export GG_DB_URL
echo "$GG_DB_URL"
```

It prints `file:///example/active%20A/graphgoblin.db`. Run `node apps/api/dist/main.js --preflight` with this environment: **Database** should now say `reachable and migrated`, or name pending migrations, instead of saying that the database does not exist yet. Then start as usual. Keep both variables in every environment that starts this gateway or runs a command on its store, such as `--preflight`, `--create-api-key` or a service definition, and record the database location with your backups.

### macOS launcher

The macOS launcher opens only `<data-directory>/graphgoblin.db` beside its own `master.key` and does not support an external database override, so the shell workaround above is not available there. To use an earlier database found elsewhere with the launcher, stop its gateway and back up as above. Then, following [Back up and restore](06-settings-and-secrets.md#back-up-and-restore), restore into a new, empty directory: the verified earlier `graphgoblin.db` with its own `-wal` and `-shm` files, plus the associated original data directory's `master.key`, artifacts, workspaces and other contents. Exclude any other database and its sidecars from this restored copy; never mix one database's sidecars with another's. Keep both source copies and backups intact. Select the restored directory with `--data-dir` when you rerun the installer ([Optional macOS Finder and Dock launcher](01-install-and-first-run.md#optional-macos-finder-and-dock-launcher)).

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

- the run workspaces under `workspaces/` whose names are run IDs stored in the database (matched from the locked read; if both the preview and locked read are unreadable, every workspace is kept);
- `artifacts/`;
- private chat audio under `chat-audio/`, even when database metadata is unreadable;
- the database file and its SQLite sidecars (`-wal`, `-shm`, `-journal`);
- its own database lock (`<database-file>.graphgoblin.lock`, beside the database) and, last, its data-directory lock (`graphgoblin.lock`), when it releases them. A stale lock file or `.reclaim` guard left by a stopped process is reclaimed when the reset takes that lock, and the manifest lists it.

It keeps `master.key` (the secret-store key: a backup of the database stays readable with it, and the next store reuses it), every other entry, and anything under `workspaces/` that is not a stored run ID. Only physical store-owned directories are removed; a top-level `artifacts/` or `chat-audio/` link or non-directory is kept with an explicit reason and its target is never followed. Links inside a selected removal tree are removed as links themselves. Immediately before removal the reset checks the planned identities of the physical root, every ancestor and the entry. These checks protect referenced repositories, working directories and harness installations, subject to Node's remaining race: it offers no handle-relative removal, so an external process can still change the tree between a check and removal. The lock prevents concurrent GraphGoblin changes. Browser device drafts live in each browser; see [Old device drafts](#old-device-drafts-in-a-browser).

A sidecar is removed as the directory entry its name opens, never as another name of the same file. A hard link of a sidecar under another name is a separate entry and is kept with its bytes. At the top level of the data directory it is listed under Keeps with the reason `another name for graphgoblin.db-wal; the file stays under this name`. Beside a database in a subdirectory it is kept without a row, like everything else in that subdirectory. If the directory lists a sidecar only under another spelling (for example `GRAPHGOBLIN.DB-WAL` on a volume that ignores letter case), the reset uses the one listed name with the same file identity. If several hard links could be that spelling, Windows is asked which one the name opens and its answer is checked. On other systems, or when Windows gives no usable answer, the reset refuses and asks you to move the other names. If `GG_DB_URL` spells the database file differently from the listing, SQLite names its sidecars after the configured spelling. The reset therefore checks both spellings before it reads the store. It refuses unless both name the same entry or neither finds one, and then asks you to configure `GG_DB_URL` with the name as the directory lists it. It also refuses, naming both, when a sidecar is the same file as one of its lock files or guards, or as `artifacts`, `chat-audio` or `workspaces`. A lock file whose record cannot be verified is refused earlier, as any such lock is.

An inspectable special file (socket, FIFO or device) inside a removed directory is unlinked, a special file at the root is kept, and a special file configured as the database is refused. Some entries cannot be inspected without following them on a particular system: Windows AF_UNIX socket files, for example, make Node's `lstat` return access denied. Both the dry run and confirmed reset then refuse, naming the path and changing no data-directory byte. Stop the program using it, check its permissions, and move or remove that entry yourself before running the reset again. The reset never guesses its identity or removes it blindly.

A reset cannot be undone. If you might want the data later, stop GraphGoblin and copy the whole data directory somewhere safe first, including the database/sidecars, `master.key`, `artifacts/`, private `chat-audio/` files and retained workspaces.

## List what a reset would remove

Stop every GraphGoblin process that uses the data directory (the API, `pnpm start`, a service or container). Then, from the checkout, with the same environment the server uses (`GG_DATA_DIR`, `GG_DB_URL`):

```powershell
node apps/api/dist/main.js --reset --data-dir "C:\Users\you\.graphgoblin"
```

This dry run reads and prints; it changes no byte in the data directory. It does not open the database with SQLite, which would rewrite its sidecar files: the format marker and run IDs are read from a temporary copy. `--data-dir` is optional here; when given it must name the configured data directory. The independent reader owns that copy and removes it after its SQLite worker exits; it also monitors whether the reset CLI is still alive. If both processes are terminated before cleanup, the next valid reset also cleans stale private copies in the system temp directory. It only removes its exact dedicated prefix plus valid ownership metadata and matching directory identity, after both recorded owners are provably dead and no unexpected entries are present. Similar names, unmarked or malformed directories, links and live or uncertain owners are left alone. No age-based temp cleanup is performed. If a stale private copy cannot be cleaned, a one-line refusal names its directory: close the program holding its files, check permissions and run the reset again. Nothing in the data directory was changed, although the reaper may already have removed part of its own stale copy; its ownership marker stays until all payloads are gone. Sample output:

```text
GraphGoblin reset (dry run: nothing is removed)

Data directory: C:\Users\you\.graphgoblin
Database:       C:\Users\you\.graphgoblin\graphgoblin.db (format 3; this build requires format 4)

Removes:
  workspaces/01JRESETACCEPTANCEAAAAAAAA  run workspace            1 file, 2 directories, 1 link, 10 B
  artifacts                              artifacts                1 file, 2 directories, 13 B
  chat-audio                             private chat audio       1 file, 1 directory, 7 B
  graphgoblin.db                         database                 1 file, 4.0 KB
  graphgoblin.db-wal                     SQLite write-ahead log   1 file, 285.7 KB
  graphgoblin.db-shm                     SQLite shared memory     1 file, 32.0 KB
  graphgoblin.db.graphgoblin.lock        database lock            the reset's own; removed on release
  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release

Keeps:
  master.key                             secret-store key; kept so the secrets in a backup of this store stay readable
  workspaces/my-notes                    not a stored run ID
  Browser device drafts stay in each browser; discard them from the loop editor.

Total removed: 6 files, 5 directories, 1 link, 321.7 KB in 6 items.

Nothing was removed. To reset, stop every GraphGoblin process using this data directory and run:
  node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

Each section lists at most 20 rows and summarises the rest; the totals always cover every store item, and the lock rows are not counted. A lock file or `.reclaim` guard found before the reset takes its locks was left by a stopped process: the database lock or data-directory lock row then says `stale; replaced by the reset's own`, and a guard is listed as a `stale lock guard` that is `reclaimed when the reset takes` that lock. These are never listed under Keeps; a look-alike such as another database's lock file or an abandoned `.reclaim.<UUID>.tmp` staging directory is kept. Each lock file and guard is listed once, under the name the directory shows for it. On a volume that equates spellings this can differ from the name GraphGoblin opens (it opens `graphgoblin.lock` as a listed `GRAPHGOBLIN.LOCK`, or `οσ-1.db.graphgoblin.lock` as `ΟΣ-1.DB.GRAPHGOBLIN.LOCK` on NTFS). The reset matches them by filesystem identity, not by letter case, so a hard link of a lock under another name, or a look-alike name that is a separate file, stays under Keeps. If the directory lists several hard links that could be the lock or guard and the filesystem does not say which one GraphGoblin opens, the reset refuses and asks you to move the other names. A dry run refuses while another process holds, or may hold, either lock or its guard.

## Reset

Run the command the dry run printed:

```powershell
node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

`--yes` alone is refused: the confirmation must name the data directory, and it must be the one this environment configures (`GG_DATA_DIR`, or `~/.graphgoblin` when it is unset), so a different shell cannot reset another store by accident. The reset takes the data-directory and database locks (it refuses while GraphGoblin is running), lists its own manifest, removes exactly those items, prints each one and what releasing each lock did (`removed graphgoblin.db.graphgoblin.lock (database lock)`, then `removed graphgoblin.lock (data-directory lock)`), and ends with `Reset complete.` Its manifest says that it reclaimed a stale lock file or guard (`the reset's own, replacing a stale one`, or a `stale lock guard` `reclaimed when the reset took` that lock) only when taking that lock removed it. The dry run you ran earlier is a separate invocation, and this confirmed command does not remember it. The command takes its own read-only preview before taking the locks and later compares that preview with its locked plan. If this command's own preview listed a stale lock file or guard and the entry was gone by the time this command took that lock (for example because another GraphGoblin process, such as `--create-api-key`, took and released that lock and reclaimed it first), the row says the stale one was `already gone when the reset took` that lock, without saying who removed it. If a stale entry was cleared before this command's preview, the command makes no attribution for that entry. A different stale entry can still be in that preview, or the command can reclaim one when it takes a lock. Read this command's own manifest for what it found. A lock file whose record another program replaced during the reset is kept and named, never removed. It also refuses when a lock path is not a regular file or a guard path is not a directory. It refuses, changing no data-directory byte, when the database is outside the data directory, is not a local file (for example `:memory:`), is reached through a link, is not a regular file, or lies inside `artifacts/`, `chat-audio/` or `workspaces/`.

Before removing anything, it compares the locked plan with its own read-only preview. If the preview could read the store but the locked read fails, it refuses with the read failure and asks you to run the reset again, even if no run workspace was matched. It also refuses if the locked plan would keep a run workspace path selected by the preview, or a parent of that path, including when two successful reads return different run IDs, or if the locked plan cannot identify a sidecar as one directory entry. The locked plan removes exactly the sidecar names it lists. Both locks are released; no database, sidecar, artifact, chat audio, workspace or other store byte is changed. If taking the locks reclaimed a stale lock file or guard, or one this command's own preview found was already gone when the reset took its lock, the refusal says `No store data was removed. Lock files and guards:`. It lists each such entry, either as `reclaimed stale graphgoblin.lock (data-directory lock)` or as `graphgoblin.lock (data-directory lock): stale in the preview, already gone when the reset took that lock` (without saying who removed it), then what releasing each lock did. Otherwise it says nothing in the data directory was changed. This preserves the database needed to identify those workspaces on a rerun. If both reads are unreadable, a damaged-store reset still removes physical artifacts/chat-audio directories and database files while keeping unmatched workspaces. If only the preview is unreadable, the reset can proceed using the run IDs from the successful locked read.

If taking a lock fails (another process takes it first, the database has another hard link, or the filesystem refuses to clean up the lock's `.reclaim` guard), the refusal names the stage, `could not take the data-directory lock:` or `could not take the database lock:`, and never says that nothing was changed: the attempt itself can create or reclaim that lock's file, guard or guard staging directory and may have left any of them. It says `No store data was removed.`, lists that lock file and guard as found now and just before the attempt (for example `graphgoblin.lock.reclaim (data-directory lock guard): present now, absent before the attempt`) and, when the database lock failed, what releasing the data-directory lock did. It does not say who changed an entry, and it never removes one it has not taken. Fix the cause and run the dry run to see what is there: a lock file or guard whose recorded owner is verified to have exited is listed as stale, and one whose owner may still be running refuses the reset.

If something goes wrong part of the way (for example another program holds a file open), the reset stops, releases its locks and reports exactly what it removed, what it removed partly (with counts), what it did not remove and what releasing each lock did. Do not start GraphGoblin on that directory until the reset finishes: fix the cause and run the same command again; it lists and removes what is left.

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

## Install Goblin and pair a device

Goblin is the separate chat PWA at your gateway’s `/goblin/` address. It installs alongside the GraphGoblin management PWA at `/app/`; each has its own manifest identity, start URL, service-worker scope and update prompt. Goblin has no management navigation or API-key panel. Its device credential is stored separately from the management API key.

Enable API-key authentication (`GG_REQUIRE_API_KEY=true`), sign in with a wildcard owner key,
then open **Chat → Devices → Pair a device**. A loopback gateway with no `GG_PUBLIC_URL` can create
a **This computer only** link immediately; open it in another tab/browser or the installed Goblin
app on that computer. Test this path before configuring a phone. The gateway’s chat loop must be
published and satisfy the chat contract.

For other devices on ordinary home Wi-Fi, configure a stable reachable HTTPS gateway origin in
`GG_PUBLIC_URL`, including its port, and a listener/reverse proxy that serves both shells and the
API. Trust its certificate on each device before installing or recording. The network pairing
screen offers QR, link and manual code. A phone’s localhost addresses the phone, not the gateway;
a computer-only link cannot pair that phone. Pairing checks configuration but does not open ports,
configure a proxy or install trust certificates. An invalid explicit public URL is refused.

Open the link on the device. The code travels in the URL fragment and Goblin removes that fragment immediately. Install Goblin first, copy the code, then open the installed app and paste it there. Enter a name for this device and choose **Pair**. On the link’s install screen, **Pair this browser instead** opens the browser pairing form; choose **Pair this browser** there to pair that browser explicitly. Safari and an iPhone or iPad Home Screen app can keep separate browser data: pairing Safari does not transfer that connection to the installed app. Opening or installing the shell never uses the pairing code automatically.

A code expires after 10 minutes and is case-sensitive. If the acknowledgement is lost, use **Retry pairing**: Goblin already saved the same claim identity and device credential before its first request. Reloading does not submit a claim automatically. After a completed claim’s code expires, retry can check the already saved credential to recover the connection. A retry keeps the original device name; rename it on the gateway after pairing.

Install **Goblin** using your browser’s install option. On iPhone or iPad, use **Share → Add to Home Screen**. Goblin uses the gateway that hosts its shell. To change gateways, open that gateway’s `/goblin/` URL and pair there. The **Open another gateway** field performs navigation to that origin; it does not forward your credential to a remote gateway.

The shell opens offline after installation, and an unsent draft can remain in browser session storage. Sending is blocked offline. Reload and reconnect check an uncertain request with a read-only lookup; they never resend a command automatically. A service worker caches only shell files and fonts. It never caches `/chat` responses, transcripts, credentials or uploads, and it never queues or replays mutations. An update waits for **Update** in the app’s prompt and for every controlled tab to have no unsent voice or unresolved submission. Voice drafts stay in memory only; closing/reloading can lose them. If safe live activation is unavailable, finish or discard drafts and close all app windows to update.

Use **Gateway → Sign out on this device** to remove its local credential and draft. The gateway retains its device record, loop and history. The owner can revoke the device under **Chat → Devices** to stop future access. Invalid and revoked credentials show the same lost-access screen; pair again with a new owner-issued code. Already accepted runs can continue after revocation; the owner can cancel them separately.

### Serve the Goblin shell

The web build produces both `apps/web/dist` and `apps/web/dist-goblin`. The API serves these at `/app/` and `/goblin/` by default when they exist. Set `GG_GOBLIN_DIST` to another built Goblin directory, or set it empty to disable that shell. `GG_WEB_DIST` independently selects the management build. The container image includes both builds.

A separate static host can serve `dist-goblin` if a reverse proxy on that **same browser origin** forwards `/chat` to the intended gateway. Serve the shell at `/goblin/`, keep its manifest and worker there, return `index.html` for extensionless `/goblin/…` navigation, and return 404 for absent assets. Forward `/chat` responses and uploads without caching, preserve `Authorization`, and use HTTPS. Set `GG_PUBLIC_URL` to that externally visible origin so enrollment links open its `/goblin/` shell. Do not expose an unauthenticated management API. GraphGoblin keeps proxy trust disabled. Requests through a reverse proxy can therefore share that proxy’s source rate limit; the gateway-wide cap also applies. Forwarded client addresses are not trusted.

For development, `pnpm --filter @graphgoblin/web dev:goblin` serves the peripheral on port 5174 and proxies `/chat` to `GG_API_URL` (default `http://127.0.0.1:4747`). Development does not install a service worker. Audio recording requires a secure browser context. The composer supports microphone audio only; non-audio attachments are deferred. Configure Voice in gateway Settings, test the local or cloud connection, preview/stage the ordinary normalizer and publish each applicable chat loop. Local runtime qualification/model setup and cloud credentials belong to the gateway, never the peripheral device.
