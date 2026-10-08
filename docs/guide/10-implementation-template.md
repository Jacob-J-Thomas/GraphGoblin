# Use the GitHub issue implementation template

This template watches one GitHub repository for open, labeled issues. It runs bounded implementation work in a worktree, executes the configured gate, and can open a pull request. Publishing the parent enables polling and authorizes repository changes, so configure a repository you are prepared to let it modify.

## Prepare the repository and credentials

Use a dedicated local clone of the target GitHub.com repository that the GraphGoblin API process can access. The configured owner and repository name must match the clone's origin. The base branch must exist on that origin; GraphGoblin checks it when it prepares the first issue workspace.

```powershell
gh auth login
gh auth status
git clone https://github.com/<owner>/<repository>.git <checkout-path>
git -C <checkout-path> remote get-url origin
```

Run the authentication check as the Windows account that runs the API. An interactive terminal may use a different GitHub CLI configuration from the service. The requirements check confirms that GitHub CLI authentication and repository discovery work; it does not prove permission for every later label, comment, push, or pull-request operation.

The template uses four repository labels to select work and record its progress. The defaults are:

- Trigger: **ready-for-implementation**
- In progress: **in-progress**
- Pull request open: **pr-open**
- Blocked: **blocked**

You can change these names in the form. The **Check requirements** report does not verify that the labels exist. Create all four configured labels before publishing the parent; the poll and issue preparation check their presence before acting. Polling considers open issues with a nonblank title and description that have the trigger label.

Create a revocable GraphGoblin API key with exactly the **runs:read** scope. Store its value in **Settings → Secrets** and set the template's secret reference to the exact name **supportReadKey**. The form asks for the name, never the token value. This key is separate from GitHub CLI authentication. See [Settings and secrets](06-settings-and-secrets.md) for key and secret management. Never put a token in an issue, prompt, gate argument, or evidence note.

The API checks the selected role's enabled model and effort against the current catalog and harness preflight. It selects a supported Codex default when one is available. Claude is offered only when its installed harness, authentication, model, effort, and required execution policy pass preflight. The form does not install a harness or choose a billing plan.

## Configure and create the workflow

On **Loops**, choose **New from template**, then **Use GitHub issue implementation**. Fill the fields:

| Setting                             | What to enter                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout path                       | Absolute path to the existing canonical clone. GraphGoblin checks the repository root and origin, then keeps its journals and support worktrees within the clone.                              |
| Repository owner, name, base branch | Exact GitHub owner and repository matching the clone. The base branch must exist on origin; its existence is checked when a labeled issue is prepared.                                         |
| Support credential key name         | **supportReadKey**, referring to the saved secret. Do not enter the token itself.                                                                                                              |
| Implementer model and effort        | A currently enabled selection admitted by harness preflight.                                                                                                                                   |
| Program and arguments               | Defaults are **pnpm** and one argument, **check**. Enter each argument separately, one per line. Arguments are passed literally; shell operators and command-line quoting are not interpreted. |
| Timeout                             | Gate deadline in seconds; default 600, range 1–86,400.                                                                                                                                         |
| Labels                              | The four names above, or your chosen names. All four must exist in the repository before polling or issue preparation.                                                                         |
| Maximum tasks                       | Maximum tasks in a split plan; default 8, range 2–32.                                                                                                                                          |
| Gate fixes                          | Additional gate-fix cycles after the initial gate run; default 2, range 0–10.                                                                                                                  |
| Maximum iterations                  | Parent-loop limit; default 100, range 1–10,000.                                                                                                                                                |

On Windows, keep the default program as **pnpm** unless you have a verified native alternative. The packaged support resolves it through the API's Node executable and an installed **pnpm.cjs** launcher. Generic **.cmd** and **.bat** programs are refused. A gate runs as a native process in the prepared issue worktree with the configured argument array and timeout.

Choose **Check requirements** after filling the form. It checks the selected role and harness, repository root and origin, GitHub CLI authentication and repository discovery, the secret's owner and exact scope, and the installed support entry. It does not check label existence, base-branch existence, or every write permission that later GitHub operations require. Editing a setting makes the report stale; check again before **Create draft**. The API repeats the checks during creation and before a run.

Creation makes a distinct template instance. Its worker loop is published and pinned before the parent is created as a draft. Creation does not start a run or poll issues. Review the graph and settings, then publish the parent yourself when you are ready to enable its scheduled poll.

## Start and follow issue work

The parent has a poll trigger, not a manual issue-number trigger. The **Run** page cannot manually select an issue for this template. To make one issue eligible, keep it open with a nonblank title and description and add the configured trigger label. To prioritize one known issue, make it the only eligible issue with that label. If several issues are eligible, the poll does not show an issue picker; it admits at most one candidate every 60 seconds.

Before preparing an issue, support checks that all configured labels exist, the issue is still open and eligible, the base branch exists, and the repository identity still matches. It then creates the contained workspace, removes the trigger label, and adds **in-progress**. When a pull request is completed, **pr-open** replaces **in-progress**. A blocked workflow after progress adds **blocked** and removes **in-progress**. A failure before workflow nodes start may happen before these label changes.

For one cohesive change, the planner uses a direct plan. For multiple distinct tasks, it can choose a split plan. Split tasks run sequentially, each in its own worktree and branch; a completed task is merged into the issue branch before the next task starts in a fresh worker session. Planner, worker, gate-fixer, and pull-request proposal sessions are fresh.

After implementation, the configured gate runs once. If it fails, the workflow can request a fresh gate-fixer session and retry the gate up to the configured number of gate fixes. The workflow then validates a pull-request proposal and can create one pull request in the same repository, with a body that closes the admitted issue. GraphGoblin does not merge it. Normal human review and repository protections still apply.

## Rotate the support key and recover safely

The API resolves the **supportReadKey** secret for support calls. The same credential authenticates the local implementation journal. Replacing or revoking the key while an attempt has started can prevent later support calls from authenticating that attempt's journal. Rotate it when no implementation run is active or awaiting recovery. If the key is compromised, revoke it promptly; preserve any affected run, journal, branch, and worktree for manual reconciliation instead of trying to edit or delete them.

A same-run resume is allowed only when the run shows the fixed **TEMPLATE_PREREQUISITE_UNAVAILABLE** failure as resumable, no workflow node has started, and the pinned template and issue identity still match. Repair the named prerequisite and use **Resume** on that same run; the API checks it again. A support failure after a node has started is not this pre-execution case.

Other terminal failures do not have a generic reset. Removing and re-adding the trigger label does not retry a consumed attempt. Preserve the run and its worktree for manual reconciliation. If process termination is unconfirmed, do not delete or reuse the worktree. If pull-request creation is uncertain, reconcile the existing branch and pull request before taking further action; the support will not create a second pull request to repair an ambiguous first attempt.

## Understand the execution boundary

Packaged support validates the configured GitHub repository and keeps its journals and Git worktrees within the clone. This does not confine the whole workflow to that directory or create an operating-system sandbox. The configured gate is a native process running as the GraphGoblin API account and can access files that account can read. The selected model harness has its own execution policy, but that policy is not a substitute for operating-system isolation. Use an API account and host whose file access is appropriate for the repository and gate you configured.
