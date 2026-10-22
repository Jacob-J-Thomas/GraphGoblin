# Research - libsql quirks

Captured 2026-10-02 while stabilising the `apps/api` test suite. Versions: `@libsql/client` 0.18.0, `libsql` 0.5.29 (`@libsql/win32-x64-msvc`), Node 23.10, Windows 11.

## Worker-thread teardown crashes the process (Windows)

- If the libsql native addon is loaded only inside a `worker_threads` worker, the worker's exit can crash the whole process with an access violation (0xC0000005, `Segmentation fault` in Git Bash) or hang it. In a minimal script that opens a `:memory:` or `file:` client in a worker, runs one statement, and closes it, 4 of 10 runs crashed. Without `close()`, 1 of 10 runs hung and none crashed.
- The process main thread and forked child processes never crashed: 0 failures in 20 runs of the API suite under `pool: 'forks'` and in every plain-process experiment. Loading the addon on the main thread before the worker starts also prevented the crash (0 of 20).
- Consequence: packages whose tests touch libsql (`infrastructure`, formerly `adapter-sqlite`, and `apps/api`) pin Vitest to `pool: 'forks'`. Do not accept a `vitest doctor` suggestion to switch them to `threads` or `vmThreads`. If a production component ever runs libsql inside a worker thread, load the addon on the main thread first.

## Single connection for `:memory:`

- An in-memory client has exactly one connection. A second `transaction()` or a plain `execute()` while a transaction is open throws `TRANSACTION_ACTIVE` rather than queueing. `serializeClient` in `packages/infrastructure/src/sqlite/db.ts` serialises all statements and transactions through a mutex for this reason.
- `close()` is safe to call twice, rejects later calls with `CLIENT_CLOSED`, and closes any open transaction (`TRANSACTION_CLOSED`).

## Closed files stay locked until collection (Windows)

Measured 2026-10-18 for #266 (`@libsql/client` 0.18.0, `libsql` 0.5.29, Node 22.14, Windows 11). After `close()` on a plain client, a client with a committed transaction, a `serializeClient` handle and a `mode=ro` read-only client, `unlink` of the database, `-wal` and `-shm` failed with `EBUSY` in every case; after `global.gc()` the files could be removed. The native connection is released only when its prepared statements are garbage collected. Opening a WAL-mode database read-only (`mode=ro`) also created `-wal` and `-shm` beside a database that had none. A process that must remove a database it read (the `--reset` command) therefore reads a private copy in a child process, whose exit releases every handle, and never opens the original.
