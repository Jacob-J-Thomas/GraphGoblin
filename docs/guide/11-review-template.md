# Start a review workflow

On **Loops**, choose **New from template**, then **Use Review workflow**. GraphGoblin copies the starting graph into an independent ordinary draft and opens it immediately. See [Start from a template](09-templates.md).

Supply the change, review criteria and relevant source or pull-request context in run input. Configure a local checkout in loop settings when needed; the default directory is temporary. Choose models and effort on inference nodes or inherit normal defaults. Creation does not publish or run the copy.

A manual trigger and instruction mutation lead to a fresh read-only reviewer (300-second timeout). It returns `status`, `summary` and `findings`. An expression decision routes `approved` to success, `blocked` to failure, and `changes-needed` to a separate fresh fixer with `workspace-write` (900 seconds). The fixer edits accessible source or proposes a patch, then a loop-back exit returns to the reviewer. The initial iteration limit is 3; unresolved findings at the ceiling exhaust the run. Terminal exits return the review to the caller.

Inspect the prompts, directory, evidence, stopping conditions and limits before publishing. The reviewer sees supplied context and accessible files; a separate fresh session does not guarantee independence of evidence or enforce proof isolation.

The graph does not fetch or authenticate an exact PR head, poll CI, submit a native GitHub approval, commit, push, create or close PRs, change labels or merge. Its prompts prohibit GitHub effects and external services. A model's `approved` result is an opinion, not CI freshness, signed recovery evidence or permission to merge. Any later trigger or integration must be explicitly authored with ordinary nodes and configured capabilities.
