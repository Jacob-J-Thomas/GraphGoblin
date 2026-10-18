# Start an implementation workflow

On **Loops**, choose **New from template**, then **Use Implementation workflow**. GraphGoblin copies the starting graph into an independent ordinary draft and opens the editor. There is no settings form in the gallery. See [Start from a template](09-templates.md).

Supply a task, acceptance criteria and source context in the run input. The default working directory is temporary; configure a checkout in loop settings to edit local source. Inference nodes inherit normal model and effort defaults unless you choose overrides. Creation does not publish or run the copy.

The starting graph uses these ordinary nodes:

1. A manual trigger receives input; a mutation sets the workflow instructions.
2. A fresh read-only planner proposes scope, implementation steps and concrete verification (300-second timeout).
3. A fresh implementer uses `workspace-write` to edit accessible source, or proposes a patch when only text is supplied (900 seconds).
4. A fresh read-only verifier assesses the changes and supplied evidence (300 seconds), returning `status`, `summary` and `checks`.
5. An expression decision routes `passed` to success, `blocked` to failure, or `changes-needed` back to implementation through a loop-back exit. The initial iteration limit is 3; reaching the ceiling exhausts the run. Terminal exits return the verification to the caller.

Review instructions, verification, directory, model choices and limits before publishing. Inspect actual observations in the run inspector: the verifier is a model assessment, not a native command gate or proof that an unchanged commit passed CI.

The graph does not discover GitHub issues, claim work, prepare verified checkouts, create worker subloops or task worktrees, commit, push, create pull requests, change labels or merge. Its prompts prohibit GitHub effects and external services. These instructions do not provide operating-system confinement or proof isolation. Add any later integration explicitly through ordinary loop authoring; a template copy grants no special authority.
