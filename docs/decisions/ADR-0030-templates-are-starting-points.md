# ADR-0030: Templates are starting points

Status: Accepted from the owner's direct product instruction (2026-10-09)

## Context

ADR-0028 introduced editable template copies but retained an optional configured-automation action from ADR-0027. The owner rejects gallery setup: a template is a starting point for an ordinary loop, not a repository-bound instance. The owner has also decided to retire the template-instance backend and its privileged GitHub automation after the feature branch merges.

## Decision

Each gallery card shows the starting point's description and one green **Use &lt;template name&gt;** button. It copies the installed template into an ordinary independent draft and opens the editor. The gallery has no template settings form, role/model/effort/repository/gate/label/budget controls, prerequisite or readiness presentation, or configured-automation action. Creation never requests a repository or GitHub URL, publishes a loop, or starts a run.

Users customize the copied graph through ordinary loop authoring: inference nodes and defaults select models, loop settings choose the working directory, and nodes, variables, scripts, triggers and explicit graph limits hold workflow configuration. Copies have no immutable template-instance binding. Editing a copy leaves other copies and the catalog unchanged. Pending activation is guarded; failed creation receives an error without automatic retry, and failed editor handoff can reopen the already-created loop without another copy.

Template settings, configured instances and their privileged GitHub automation are retired as product concepts. Backend removal, storage cutover and existing-instance disposition are tracked separately in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165). This UI change leaves prerequisites, instantiate and template-instance endpoints, generated client helpers, storage and execution authority intact until that follow-up; the gallery stops calling the setup endpoints. Existing bound QA parents keep their isolation warning during this interval, while ordinary copies do not receive it.

This decision supersedes the **Configure automation** paragraph and retained-instance consequences of [ADR-0028](ADR-0028-editable-template-starting-points.md), and the instance concept of [ADR-0027](ADR-0027-bundled-template-instances.md). It preserves ADR-0028's ordinary editable-copy behavior.

## Consequences

The gallery has one creation action and no setup-only model or preflight requests. Tests cover independent copies, editing without catalog mutation, guarded creation, errors and handoff recovery, keyboard focus and narrow layouts. Backend retirement remains separate work; this change does not weaken existing authority checks or convert stored instances. The owner reviews the running gallery before merge.
