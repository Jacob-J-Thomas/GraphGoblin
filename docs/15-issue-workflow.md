# 15 - Issue workflow

GitHub issues are the shared work queue for this repository's development pipeline. Every non-epic issue carries at least one gate label. A triager sets the type, area, gate, QA, and routing labels from the issue and its dependencies.

## Gates

- `aidlc-ready`: the issue may enter this repository's agent-led development pipeline without a human review of the running product. Use for bug fixes, maintainability, chores, and backend-only work.
- `human-in-the-loop`: an agent implements; a human reviews the running product before merge. Use for UI work and work whose effectiveness must be judged in the product.
- `needs-plan-approval`: for architecture changes and cutovers. An agent posts a written plan as an issue comment. A human approves by replacing this label with `plan-approved` and adding `aidlc-ready`, unless the issue also has `human-in-the-loop`.
- `plan-approved`: set by a human only, after reviewing the written plan.

`needs-plan-approval` may be combined with `human-in-the-loop`. `aidlc-ready` never combines with `human-in-the-loop`. A non-epic issue with both plan approval and human product review proceeds with `plan-approved` and `human-in-the-loop` after approval.

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

Milestones are `v1.1` for editor usability and polish and catalogue fixes, `v1.2` for visual identity, dark mode, templates, and GitHub integration, and `Later` for distribution, LiteLLM, and mobile.

Epics carry `type:epic` and area labels only; pipelines ignore them. Each child issue starts its body with `Part of #<epic-number>`, and the epic lists its child issues.

## Development pipeline

An issue is picked up according to its gate label. The implementer named by its `impl:` label works in an isolated branch. The reviewer named by its `review:` label reviews the diff and comes from the opposite model family. A QA agent tests according to the `qa:` label and records results in the PR and the issue. `human-in-the-loop` issues get a human review of the running product before merge. `needs-plan-approval` issues get a human-approved plan before implementation. When the owner requires a human QA sign-off before an issue closes (recorded as a comment on the issue), its pull requests reference it as "Part of" rather than "Closes", the pipeline never closes it, and the human who verified the running product closes it with a comment saying what was checked.

The label names and this process are specific to this repository and are not used by the product's template loops, which users run against their own repositories with their own configurable trigger label and role models (tracked in [the AIDLC template loops epic on GitHub](https://github.com/Jacob-J-Thomas/GraphGoblin/issues?q=is%3Aissue%20label%3Atype%3Aepic%20label%3Aarea%3Atemplates)).
