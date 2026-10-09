# ADR-0027: Bundled templates create isolated draft instances

Status: Accepted for construction under the owner-authorized #28 plan (2026-10-08)

The gallery's default creation flow is superseded by [ADR-0028](ADR-0028-editable-template-starting-points.md). This decision continues to govern the explicit configured-automation path.

## Context

Reusable loops need installation-aware requirements and safe child remapping. Copying a JSON graph alone cannot pin a fresh child bundle or establish repository workflow authority. GraphGoblin's engine remains general purpose; GitHub lifecycle rules do not belong in its run or admission contracts.

## Decision

A versioned manifest and current-format exports form a bundle. Contracts describe the public manifest, typed settings, prerequisite report and instance. Domain logic validates generic dependency/graph integrity and prepares definitions from owner-allocated IDs. It substitutes declared role fields and literal settings data, never scripts, expressions or prompt source. Every inference role uses the existing fresh-session policy. No new context or session semantics are introduced.

The API loads bounded regular assets from the installed catalog and rejects linked or escaping paths. Creation checks current prerequisites, allocates independent loop/version IDs, remaps declared subloops and commits the complete bundle with an immutable API-owned binding in one transaction. Children are published first; the parent stays a draft. Failure rolls everything back. The API also owns any later repository subject and effect policies; generic engine hooks cannot infer GitHub authority from model output or user payload names.

Prerequisites distinguish authoring blockers from runtime blockers. A runtime-unavailable capability may allow a draft, but publication or execution cannot turn a report into proof that the capability exists. In particular, current adapters do not provide verified production isolation for adversarial QA. There is no user flag to claim otherwise, and no isolation platform is added by this decision.

## Delivery

Register the starter catalog entry first. Add repository recipes only after their bounded real workflow verification. Ship authored assets with the API and copy the catalog explicitly into the built distribution. A source-only template gate validates every registered bundle and proves rejection with a deliberately invalid graph. Package/image acceptance must execute the actual installed support entry, not merely find its filename.

Per-node continuity (#33), context co-design (#38), default canvas spacing (#124) and saved layout investigation (#125) remain outside this work.
