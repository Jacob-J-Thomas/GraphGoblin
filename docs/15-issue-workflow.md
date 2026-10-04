# 15 - Issue workflow

GitHub issues are the shared work queue for people and the AIDLC pipeline. Every non-epic issue carries at least one gate label. A triager sets the type, area, gate, QA, and routing labels from the issue and its dependencies.

## Gates

- `aidlc-ready`: an AIDLC pipeline may implement, review, QA, and merge without a human. Use for bug fixes, maintainability, chores, and backend-only work.
- `human-in-the-loop`: an agent implements; a human reviews the running product before merge. Use for UI work and work whose effectiveness must be judged in the product.
- `needs-plan-approval`: for architecture changes and cutovers. An agent posts a written plan as an issue comment. A human approves by replacing this label with `plan-approved` and adding `aidlc-ready`, unless the issue also has `human-in-the-loop`.
- `plan-approved`: set by a human only, after reviewing the written plan.

`needs-plan-approval` may be combined with `human-in-the-loop`. `aidlc-ready` never combines with `human-in-the-loop`. A non-epic issue with both plan approval and human product review proceeds with `plan-approved` and `human-in-the-loop` after approval.

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

## Planned AIDLC lifecycle

The intended template loops will process `aidlc-ready` issues as follows: the implementation loop picks up the issue and opens a PR with a structured body; the review loop runs at most three review-and-fix cycles; after merge, the QA loop saves proof, reopens the issue on failure, and has an adversarial reviewer check the QA assessment. These template loops are tracked as issues in milestone `v1.2`.
