# ADR-0028: Templates start as editable drafts

Status: Accepted from the owner's direct product instruction (2026-10-09)

## Context

The gallery required users to complete repository settings before they could copy a template. That reverses the intended workflow: a template should provide a useful graph to explore and customize immediately. The configured instances from ADR-0027 pin child versions and integration authority; their execution binding deliberately rejects substantive edits. Removing only the form or weakening that binding would not produce an editable starting point.

## Decision

**Use template** creates one ordinary loop draft from a bounded, validated, installed authoring asset and opens the normal editor. The asset supplies the graph, prompts and limits. It uses manual input and existing context, with no guessed repository identity, secret reference, scheduled GitHub trigger or privileged support command. Model choices can use normal inheritance. Draft creation needs neither repository configuration nor model authentication; publish and run validation retain their usual meaning.

These drafts have no immutable template-instance binding or published children. They can be edited, exported and published as ordinary loops. Creation never publishes or starts work. Repeated activation while a request is pending is guarded, and a successful creation is retained across a navigation failure.

Repository templates also offer an explicit optional **Configure automation** action. It keeps ADR-0027's configured instance path, prerequisite checks, atomic child remapping, immutable bindings and GitHub effect policies. It creates a separate automation instance rather than silently replacing an edited draft. A general QA assessment does not establish authenticated proof or bypass the configured post-merge QA isolation refusal.

## Consequences

Template authors can supply a separate starting-point asset alongside a configured bundle. Both are checked and packaged with the installed catalog. Existing bound instances remain unchanged and no stored-data migration is required. This decision supersedes ADR-0027 only as the gallery's default creation flow; it retains that ADR's configured integration boundary.

The owner will validate the updated local product before the feature branch merges into main. Per-node session continuity, question-context redesign and canvas layout changes remain deferred.
