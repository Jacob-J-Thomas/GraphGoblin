# ADR-0020 - Clean design over backward compatibility until release

Date: 2026-10-04. Status: Accepted.

## Context

The product has no production users. Maintaining old contracts would add input schemas,
deprecation paths, tolerant parsing, and duplicate behavior before the design has settled.
The owner answered issue #19's open questions at 18:09Z on 2026-10-04:

> I'm not really worried about maintaining v1 compatibility. I'd rather ensure the code is as well written, and maintainable as possible
>
> prioritize clean design over backward compatibility until further notice for this repo
>
> There is no reason to support legacy.

## Decision

Prioritize clean design over backward compatibility until the owner revisits the stance at
release. Change contracts, storage, and APIs to their clean shape. Do not add compatibility
schemas, deprecated input paths, tolerant parsing of obsolete data, or dual code paths.

When stored data must change, ship a one-off migration that rewrites it. Describe changes
required for exported files and clients in CHANGELOG upgrade notes. The owner updates the
local instance by hand where necessary.

This is the rule in [AGENTS.md](../../AGENTS.md#rules) and
[vision and scope, principle 8](../01-vision-and-scope.md#design-principles-decided).
[ADR-0019](ADR-0019-inference-node-harness.md) applies it to harness placement.

## Consequences

Code has one current contract and fewer maintenance paths. Pre-release clients, portable files,
and device drafts may require changes or be discarded. Storage upgrades remain explicit and
testable. Revisit this policy when the product ships or the owner directs otherwise.
