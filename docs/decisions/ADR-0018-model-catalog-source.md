# ADR-0018 - Harness model metadata is managed; enabled is an owner preference

Date: 2026-10-04. Status: Accepted.

## Context

Catalog PUT previously both edited metadata and toggled enabled, while deleting a seeded model lasted only until restart. The legacy schema cannot distinguish user-added or edited models from harness defaults. LiteLLM integration has not shipped.

## Decision

Every catalog entry has `source: 'harness' | 'litellm'`. Migration `0004` adds `source TEXT NOT NULL DEFAULT 'harness'`, classifying every legacy row as harness-owned. Hand-added legacy rows are frozen for edit/delete, even when absent from the seed, but remain toggleable. This avoids inferring provenance and keeps ownership stable when the seed changes. Allowing deletion of unseeded harness rows was considered and rejected because it would make ownership depend on the current seed.

Startup inserts new seeds as harness entries and refreshes display name, efforts, and default effort of seeded harness rows, including user-edited ones. It never changes enabled. Hand-added rows absent from the seed keep their metadata; LiteLLM rows are not refreshed.

`PATCH /model-catalog/{harness}/{model}` changes only enabled for either source. Harness PUT/DELETE return 409 `MODEL_MANAGED_BY_HARNESS`. Existing LiteLLM rows can be edited/deleted; source is immutable. New LiteLLM PUT returns 409 `LITELLM_NOT_CONFIGURED` until the provider work defines configuration and keys. No provider key convention is introduced here.

Catalog membership remains advisory: API validation returns `MODEL_DISABLED` or `MODEL_NOT_IN_CATALOG` warnings for explicit inference, decision Codex, and loop-default models. Warnings include paths and node ids when applicable and never block publish or runtime execution.

## Consequences

Old PUT toggle callers must switch to PATCH; API-client upsert/remove remain for LiteLLM rows. The existing Settings checkbox uses PATCH; Add/Edit/Delete retain the existing error display until the separate Settings redesign. MCP and the Codex plugin have no catalog-write callers.

### Migration and rollback

The migration preserves rows and all old columns. SQLite lacks `ADD COLUMN IF NOT EXISTS`, so the database migrator checks `PRAGMA table_info(model_catalog)` and skips only the exact column-addition statement if source already exists, while recording its original hash/timestamp in the Drizzle ledger. Pending SQL and ledger writes use libsql's atomic migration batch, preserving Drizzle's timestamp ordering. Fresh startup and repeated migrations are supported.

For rollback, stop the API and make a full data backup first. Run `ALTER TABLE model_catalog DROP COLUMN source;` and `DELETE FROM __drizzle_migrations WHERE created_at = 1791136800000;`, then use the previous release. This removes provenance but keeps all model rows and their other fields. A subsequent upgrade reclassifies them as harness. Dropping the column does not undo startup's seed metadata refresh: restore the pre-upgrade backup to recover user-edited seed metadata or LiteLLM provenance. Never run this against a live server.
