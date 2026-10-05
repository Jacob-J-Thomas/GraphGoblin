# ADR-0018 - Harness model metadata is managed; enabled is an owner preference

Date: 2026-10-04. Status: Accepted.

## Context

Catalog PUT previously both edited metadata and toggled enabled, while deleting a seeded model lasted only until restart. The legacy schema cannot distinguish user-added or edited models from harness defaults. LiteLLM integration has not shipped.

## Decision

Every catalog entry has `source: 'harness' | 'litellm'`. Migration `0004` adds `source TEXT NOT NULL DEFAULT 'harness'`, classifying every legacy row as harness-owned. Hand-added legacy rows are frozen for edit/delete, even when absent from the seed, but remain toggleable. This avoids inferring provenance and keeps ownership stable when the seed changes. Allowing deletion of unseeded harness rows was considered and rejected because it would make ownership depend on the current seed.

Startup inserts new seeds as harness entries and refreshes display name, efforts, and default effort of seeded harness rows, including user-edited ones. It never changes enabled. Hand-added rows absent from the seed keep their metadata; LiteLLM rows are not refreshed.

`PATCH /model-catalog/{harness}/{model}` changes only enabled for either source. Harness PUT/DELETE return 409 `MODEL_MANAGED_BY_HARNESS`. Existing LiteLLM rows can be edited/deleted; source is immutable. New LiteLLM PUT returns 409 `LITELLM_NOT_CONFIGURED` until the provider work defines configuration and keys. No provider key convention is introduced here.

Catalog membership remains advisory: API validation returns `MODEL_DISABLED` or `MODEL_NOT_IN_CATALOG` warnings for explicit inference, decision Codex (when the strategy includes Codex), and loop-default models. Warnings include node-relative paths with node ids when applicable and never block publish or runtime execution.

## Consequences

Old PUT toggle callers must switch to PATCH; API-client upsert/remove remain for LiteLLM rows. The existing Settings checkbox uses PATCH; Add/Edit/Delete retain the existing error display until the separate Settings redesign. MCP and the Codex plugin have no catalog-write callers.

Amendment (#24): the Settings redesign uses enable switches and hides Add/Edit/Delete for harness entries; LiteLLM entries retain metadata actions with plain refusal messages.

### Migration and rollback

The additive migration preserves rows and all old columns. Drizzle's standard migrator applies it once and records it in the migration ledger. Fresh startup and repeated migrations are supported.

Original guidance (superseded by the amendment below): for rollback of `0004` alone, stop the API, make a full data backup, and run the previous release. No SQL rollback is required for this additive column: the previous release ignores it and its migrator is a no-op on the upgraded database. Old-style inserts receive the `harness` default. Re-upgrading `0004` is also a no-op, retaining LiteLLM provenance and enabled choices. After `0005` has removed the loop-default harness field, rollback also requires restoring the pre-upgrade data backup or the manual SQL procedure in the [CHANGELOG upgrade notes](../../CHANGELOG.md#upgrade-notes). The current release retains the clean canonical contract described in ADR-0020.

The original optional column-drop and ledger-editing procedure removed provenance but kept other model fields; a subsequent upgrade would reclassify every row as harness. Neither original rollback method undid startup's seed metadata refresh: restoring the pre-upgrade backup recovers user-edited seed metadata.

Amendment (phase review): ledger-editing rollback and partial rollback guidance are withdrawn. Removing one migration's ledger entry after later migrations have run prevents re-upgrade from applying it again, leaving obsolete stored definitions that the current contract rejects. The executable SQL shortcut has been removed. Stop the API and restore the full pre-upgrade data-directory backup before running the previous release, following [Back up and restore](../guide/06-settings-and-secrets.md#back-up-and-restore). This also restores seed metadata and the complete migration state; there is no partial rollback.
