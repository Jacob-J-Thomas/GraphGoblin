# ADR-0003 - SQLite with Drizzle for 1.0, Postgres for hosting

Date: 2026-10-02. Status: Accepted.

## Context

Runs, events, timers, schedules, and inbound events are high-volume, append-only, concurrently written data that need atomic state transitions. Loop definitions also benefit from being exportable as files. The 1.0 target is a single-user laptop; the later target is hosted multi-tenant.

## Decision

SQLite in WAL mode through `@libsql/client` (chosen over better-sqlite3 at implementation time: its N-API binary ships prebuilt for every Node version, whereas better-sqlite3 needs a per-ABI build that was unavailable for the development machine's Node 23), accessed through Drizzle ORM with checked-in migrations, behind repository interfaces. All client access is serialised through one in-process mutex; libsql's in-memory client has a single connection and the native binding must only be loaded on the main thread (see `docs/research/sqlite-libsql.md`). Loop definitions export and import as JSON. Postgres becomes the hosted database through an `adapter-postgres` package, with both dialects in the CI matrix from the moment that adapter exists.

## Consequences

- Zero-setup install for 1.0.
- Repository interfaces and owner ids keep the Postgres move mechanical.
- Known dialect differences, JSON and boolean handling in particular, are covered by tests rather than discovered in production.

## Alternatives considered

- Config files: no atomic transitions, no queries, poor fit for event logs.
- PGlite: Postgres SQL from day one, but WASM start-up cost and less maturity than SQLite for a local tool.
