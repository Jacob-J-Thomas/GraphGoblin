# ADR-0085 - Refuse secret-bearing Windows launcher overrides

Date: 2026-11-20. Status: Accepted for the owner-dispatched #437 work.

## Decision

Refine [ADR-0064](ADR-0064-windows-desktop-launcher.md): explicit launcher overrides may
not contain `GG_MASTER_KEY` or `GG_JEV_API_KEY`, the secret-valued GG variables in the API's
configuration contract. Compare keys with ordinal case-insensitive equality and refuse the
key regardless of its value, including empty strings. `GG_REQUIRE_API_KEY` is a boolean policy
setting and remains supported. Do not infer credentials from arbitrary ordinary values.

The installer checks before creating stages, compiling the launcher or serializing configuration.
The native launcher checks the same keys when validating configuration, including manually
edited JSON and both gateway-only and installation commands, before any gateway or shortcut
action. Refusal text is fixed guidance and never includes supplied values. There is no
acknowledgement switch or alternate persistence path.

Use the data directory's existing `master.key` and GraphGoblin's encrypted secret store.
Inherited `GG_*` variables remain excluded from persisted configuration and launcher children;
non-secret overrides and non-GG inherited variables retain their existing behavior.

## Consequences

Previously installed or manually edited JSON containing either key refuses to launch. The
operator preserves the encryption key in `master.key`, configures Jev through the secret store,
removes the refused entries and reinstalls the launcher. This change does not rewrite or erase
existing files, credential values, or backups, and does not alter the store format. The
changelog gives upgrade guidance. Native acceptance uses disposable stores, synthetic values,
upper/mixed/lowercase keys and byte comparisons of prior installed artifacts.
