# Start a QA assessment workflow

On **Loops**, choose **New from template**, then **Use QA assessment**. GraphGoblin copies the starting graph into an independent ordinary draft and opens it immediately. The gallery has no settings or prerequisite form. See [Start from a template](09-templates.md).

Provide the subject, criteria and evidence in run input. Customize instructions, model choices and limits in the editor. The initial directory is temporary; configure an accessible checkout when read-only checks need source. Creation does not publish or run the copy.

The graph starts with a manual trigger and instruction mutation. Three ordinary read-only inference nodes use separate fresh sessions, each with a 300-second timeout:

1. Criteria proposes acceptance criteria and a feasible evidence plan.
2. QA assesses supplied evidence and accessible files, returning `status` (`pass`, `fail` or `inconclusive`), `summary` and `evidence`.
3. The adversary challenges unsupported conclusions and test reasoning, returning `assessment` (`sound`, `unsound` or `inconclusive`) and `summary`.

An expression decision succeeds only for a sound challenge plus a passing QA result. An unsound challenge routes through a loop-back exit to reassess QA with the previous challenge; other results fail. The initial iteration limit is 2, allowing one reassessment before exhaustion. Terminal exits return `{qa, challenge}` to the caller. Review evidence and validation before publishing.

This worksheet does not discover merged PRs, authenticate a merge or proof, create or push proof branches, reopen issues, change labels, create PRs or merge. Prompts prohibit commits, pushes, GitHub effects and external services. It has no signed attempt reservation, durable rework budget or automatic implementation handoff.

Enforced evidence-only isolation is unavailable in this graph. Fresh sessions and read-only harness options do not establish an operating-system isolation boundary or prevent access to implementation context. A model result is an assessment of supplied evidence, not authenticated proof or a post-merge gate. Later automation requires explicitly authored ordinary nodes and configured capabilities; there is no template-instance authority.
