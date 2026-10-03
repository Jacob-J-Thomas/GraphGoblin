# ADR-0016 - API keys may delegate only their own scopes

Date: 2026-10-03. Status: Accepted.

## Context

HTTP key creation requires `api-keys:write`, but previously accepted any scopes and defaulted omitted scopes to `*`. A key limited to managing keys could therefore create an administrative key and bypass every other route's scope checks.

## Decision

Local trusted mode and callers holding `*` may create keys with any scopes and retain the wildcard default when scopes are omitted. Scoped callers must list scopes explicitly and may grant only their own scopes, including reads implied by writes. They may never grant `*`.

Omitted scopes from a scoped caller return `400 VALIDATION_FAILED`. Unheld scopes or wildcard delegation return `403 SCOPE_NOT_DELEGABLE`, listing the offending scopes in `detail` and `errors.scopes`. The HTTP handler checks delegation before creating a key, using the same scope semantics as route authorization. Administrative creation outside HTTP is unchanged.

## Consequences

`api-keys:write` allows key management without granting unrestricted delegation. Scoped automation must provide an explicit scope list, and a rejected request creates no key. An explicit empty list remains valid and creates a key without access.
