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

- the run workspaces under `workspaces/` whose names are run IDs stored in the database (matched from the locked read; if both the preview and locked read are unreadable, every workspace is kept);
- `artifacts/`;
- private chat audio under `chat-audio/`, even when database metadata is unreadable;
- the database file and its SQLite sidecars (`-wal`, `-shm`, `-journal`);
- the lock file, last, when the reset releases it.

It keeps `master.key` (the secret-store key: a backup of the database stays readable with it, and the next store reuses it), every other entry, and anything under `workspaces/` that is not a stored run ID. Only physical store-owned directories are removed; a top-level `artifacts/` or `chat-audio/` link or non-directory is kept with an explicit reason and its target is never followed. Links inside a selected removal tree are removed as links themselves. Immediately before removal the reset checks the planned identities of the physical root, every ancestor and the entry. These checks protect referenced repositories, working directories and harness installations, subject to Node's remaining race: it offers no handle-relative removal, so an external process can still change the tree between a check and removal. The lock prevents concurrent GraphGoblin changes. Browser device drafts live in each browser; see [Old device drafts](#old-device-drafts-in-a-browser).

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
  graphgoblin.lock                       the reset's own lock     removed last, on release

Keeps:
  master.key                             secret-store key; kept so the secrets in a backup of this store stay readable
  workspaces/my-notes                    not a stored run ID
  Browser device drafts stay in each browser; discard them from the loop editor.

Total removed: 6 files, 5 directories, 1 link, 321.7 KB in 6 items.

Nothing was removed. To reset, stop every GraphGoblin process using this data directory and run:
  node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

Each section lists at most 20 rows and summarises the rest; the totals always cover everything. A dry run refuses while another process holds the data-directory lock.

## Reset

Run the command the dry run printed:

```powershell
node apps/api/dist/main.js --reset --yes --data-dir "C:\Users\you\.graphgoblin"
```

`--yes` alone is refused: the confirmation must name the data directory, and it must be the one this environment configures (`GG_DATA_DIR`, or `~/.graphgoblin` when it is unset), so a different shell cannot reset another store by accident. The reset takes the data-directory lock (it refuses while GraphGoblin is running), lists the same manifest again, removes exactly those items, prints each one, and ends with `Reset complete.` It refuses, changing no data-directory byte, when the database is outside the data directory, is not a local file (for example `:memory:`), is reached through a link, is not a regular file, or lies inside `artifacts/`, `chat-audio/` or `workspaces/`.

Before removing anything, it compares the locked plan with its own read-only preview. If the preview could read the store but the locked read fails, it refuses with the read failure and asks you to run the reset again, even if no run workspace was matched. It also refuses if the locked plan would keep a run workspace path selected by the preview, or a parent of that path, including when two successful reads return different run IDs. The acquired lock is released; no database, sidecar, artifact, chat audio, workspace or other data-directory byte is changed. This preserves the database needed to identify those workspaces on a rerun. If both reads are unreadable, a damaged-store reset still removes physical artifacts/chat-audio directories and database files while keeping unmatched workspaces. If only the preview is unreadable, the reset can proceed using the run IDs from the successful locked read.

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

## Install Goblin and pair a device

Goblin is the separate chat PWA at your gateway’s `/goblin/` address. It installs alongside the GraphGoblin management PWA at `/app/`; each has its own manifest identity, start URL, service-worker scope and update prompt. Goblin has no management navigation or API-key panel. Its device credential is stored separately from the management API key.

Before pairing another device, configure API-key authentication (`GG_REQUIRE_API_KEY=true`) and a public gateway address (`GG_PUBLIC_URL=https://your-gateway.example`). Enrollment links require HTTPS, with HTTP permitted only on loopback addresses for local testing. Configure the listener and network access yourself; pairing does not change them. Sign in to GraphGoblin with a wildcard owner key, open **Chat → Devices → Pair a device**, and copy the link or pairing code. The gateway’s current chat loop must be published and satisfy the chat contract.

Open the link on the device. The code travels in the URL fragment and Goblin removes that fragment immediately. Install Goblin first, copy the code, then open the installed app and paste it there. Enter a name for this device and choose **Pair**. On the link’s install screen, **Pair this browser instead** opens the browser pairing form; choose **Pair this browser** there to pair that browser explicitly. Safari and an iPhone or iPad Home Screen app can keep separate browser data: pairing Safari does not transfer that connection to the installed app. Opening or installing the shell never uses the pairing code automatically.

A code expires after 10 minutes and is case-sensitive. If the acknowledgement is lost, use **Retry pairing**: Goblin already saved the same claim identity and device credential before its first request. Reloading does not submit a claim automatically. After a completed claim’s code expires, retry can check the already saved credential to recover the connection. A retry keeps the original device name; rename it on the gateway after pairing.

Install **Goblin** using your browser’s install option. On iPhone or iPad, use **Share → Add to Home Screen**. Goblin uses the gateway that hosts its shell. To change gateways, open that gateway’s `/goblin/` URL and pair there. The **Open another gateway** field performs navigation to that origin; it does not forward your credential to a remote gateway.

The shell opens offline after installation, and an unsent draft can remain in browser session storage. Sending is blocked offline. Reload and reconnect check an uncertain request with a read-only lookup; they never resend a command automatically. A service worker caches only shell files and fonts. It never caches `/chat` responses, transcripts, credentials or uploads, and it never queues or replays mutations. An update waits for **Update** in the app’s prompt.

Use **Gateway → Sign out on this device** to remove its local credential and draft. The gateway retains its device record, loop and history. The owner can revoke the device under **Chat → Devices** to stop future access. Invalid and revoked credentials show the same lost-access screen; pair again with a new owner-issued code. Already accepted runs can continue after revocation; the owner can cancel them separately.

### Serve the Goblin shell

The web build produces both `apps/web/dist` and `apps/web/dist-goblin`. The API serves these at `/app/` and `/goblin/` by default when they exist. Set `GG_GOBLIN_DIST` to another built Goblin directory, or set it empty to disable that shell. `GG_WEB_DIST` independently selects the management build. The container image includes both builds.

A separate static host can serve `dist-goblin` if a reverse proxy on that **same browser origin** forwards `/chat` to the intended gateway. Serve the shell at `/goblin/`, keep its manifest and worker there, return `index.html` for extensionless `/goblin/…` navigation, and return 404 for absent assets. Forward `/chat` responses and uploads without caching, preserve `Authorization`, and use HTTPS. Set `GG_PUBLIC_URL` to that externally visible origin so enrollment links open its `/goblin/` shell. Do not expose an unauthenticated management API. GraphGoblin keeps proxy trust disabled. Requests through a reverse proxy can therefore share that proxy’s source rate limit; the gateway-wide cap also applies. Forwarded client addresses are not trusted.

For development, `pnpm --filter @graphgoblin/web dev:goblin` serves the peripheral on port 5174 and proxies `/chat` to `GG_API_URL` (default `http://127.0.0.1:4747`). Development does not install a service worker. Audio recording requires a secure browser context; file attachment remains available when the configured loop accepts audio. Transcription is configured in the published loop, with no built-in provider or fallback.
