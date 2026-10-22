# 15 - Issue workflow

GitHub issues are the shared work queue for this repository's development pipeline. Every non-epic issue carries at least one gate label. A triager sets the type, area, gate, QA, and routing labels from the issue and its dependencies.

## Gates

- `aidlc-ready`: the issue may enter this repository's agent-led development pipeline. Its approved behaviour is accepted through independent agent review, tests appropriate to the acceptance criteria and independent QA: tests through public methods that directly establish a criterion are sufficient for that criterion, and API, native-process or browser evidence is added where a criterion needs it. Use for bug fixes, maintainability, chores, backend work and ordinary testable feature and UI work.
- `human-in-the-loop`: the work is implemented, reviewed, tested and merged through the same agent gates, and in addition a human exercises the merged build afterwards and records what they observed. Reserve it for feature work with substantial ambiguity, or behaviour whose correctness agents cannot readily verify with confidence. A UI change does not qualify merely because it changes a screen; a missing or failing test, or a known defect, is engineering work, not a reason for the label. Before applying it, record on the issue the feature, the specific ambiguity or verification limit, what public-interface tests and other agent evidence establish, and a concrete post-merge human QA checklist with expected observations. The label does not require a human review before merge and waives no technical gate.
- `needs-plan-approval`: for architecture changes and cutovers. An agent posts a written plan as an issue comment. A human approves by replacing this label with `plan-approved` and adding `aidlc-ready`, keeping `human-in-the-loop` when it applies.
- `plan-approved`: set by a human only, after reviewing the written plan.

`aidlc-ready` describes delivery eligibility and `human-in-the-loop` describes a later human QA obligation, so the two may coexist; `needs-plan-approval` may be combined with either. Until 2026-10-21 this file described `human-in-the-loop` as a human review of the running product before merge, classified UI work under it as a whole and said it never combined with `aidlc-ready`. That wording was this repository's own metadata, not an owner requirement for objectively verifiable behaviour; the owner's clarification of 2026-10-21 (recorded in [#279](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279)) supersedes it.

## Post-merge human QA

Every pull request for a `human-in-the-loop` issue carries a post-merge human QA checklist with expected observations and names an open tracking item (the issue itself or a linked QA item). The PR references that item as "Part of", never with a closing keyword, so the pipeline never closes it. After the merge a human exercises the merged build, records the commit or build, their observations and the outcome on the tracking item, and closes it. Human QA is tracked separately from implementation, review, agent QA, CI and merge, as one of: not required, pending merge, pending human QA, or completed with an evidence link. Agent evidence never completes the human step, and the human step never permits merging a known defect or bypassing a gate. A product decision that is needed to define correct behaviour goes to the owner as a concrete question with evidence, separately from post-merge QA.

A delivery batch may carry an additional pre-merge sign-off gate (for example, a designated independent review session that must approve each PR at an exact head). Such a gate is recorded in the batch's register under `docs/delivery/` and is separate from post-merge human QA.

## Parking markers

Two labels take an issue out of the queue; neither is a gate, and an issue carrying one has no gate label until a human unparks it.

- `backlog`: parked until further notice. Agents do not plan or implement it.
- `needs-refinement`: the problem itself still needs human-driven refinement in a working session with the owner before any plan or implementation.

## QA scope

- `qa:touched-systems`: enumerate every system the change touches, test each with positive and negative cases, and record pass/fail results with evidence in both the PR and issue.
- `qa:full-regression`: also retest the whole application end to end, covering positive and negative scenarios, and catalogue the results.

Name the QA agent in the issue body's Delivery section, not with a label.

## Model routing

The triager sets one `impl:<model>` label and one `review:<model>` label. Use the following tiers, with xhigh reasoning:

| Tier | Model             | Use                         |
| ---- | ----------------- | --------------------------- |
| 1    | `gpt-6-luna`      | Mundane work                |
| 2    | `gpt-6.1-sol`     | Default work                |
| 3    | `claude-opus-5.5` | Harder work and sign-off    |
| 4    | `gpt-6-astra`     | Hardest work and escalation |

Whatever model family implements the change, the other family reviews it: OpenAI models are reviewed by Claude, and Claude is reviewed by an OpenAI model. If a worker cannot finish, escalate to the next tier.

## Types, areas, and milestones

Every issue has one type: `type:bug`, `type:feature`, `type:ui-polish`, `type:architecture`, `type:chore`, `type:research`, or `type:epic`. Area labels locate the affected part of the product: `area:web`, `area:editor`, `area:settings`, `area:api`, `area:engine`, `area:contracts`, `area:design-system`, `area:templates`, `area:integrations`, `area:installer`, or `area:harness`.

Milestones are `Pre-merge #151` for work that must land before the feature PR merges, `After merge: evaluate and stabilise` for product evaluation, the architecture sweep and the cutovers they require (this milestone blocks further feature work), and `Later` for queued and long-term work, with most items parked under `backlog`.

Epics carry `type:epic` and area labels only; pipelines ignore them. Each child issue starts its body with `Part of #<epic-number>`, and the epic lists its child issues.

## Development pipeline

An issue is picked up according to its gate label. The implementer named by its `impl:` label works in an isolated branch. The reviewer named by its `review:` label reviews the diff and comes from the opposite model family. A QA agent tests according to the `qa:` label and records results in the PR and the issue. `human-in-the-loop` issues additionally get human QA of the merged build, tracked as described above. `needs-plan-approval` issues get a human-approved plan before implementation. When a human QA step is required before an issue closes (by the label, or by the owner in a comment on the issue), its pull requests reference it as "Part of" rather than "Closes", the pipeline never closes it, and the human who exercised the merged build closes it with a comment saying what was checked.

The label names and this process are specific to this repository and are not used by the product's template loops, which users run against their own repositories with their own configurable trigger label and role models (tracked in [the AIDLC template loops epic on GitHub](https://github.com/Jacob-J-Thomas/GraphGoblin/issues?q=is%3Aissue%20label%3Atype%3Aepic%20label%3Aarea%3Atemplates)).
