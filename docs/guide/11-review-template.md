# Use the GitHub pull-request review template

The GitHub pull-request review template watches one configured repository and base branch for eligible pull requests. It runs the configured gate on the exact pull-request head, asks a read-only reviewer for a structured verdict, and may request bounded fixes. Depending on the settings and linked issue labels, the workflow either uses the ordinary merge path after its checks or pauses for a real human choice.

## Prepare repository access

Use an existing canonical clone of the target GitHub repository. The owner and repository fields must match its `origin`. Authenticate GitHub CLI as the account that runs the GraphGoblin API; an interactive terminal can use a different account configuration.

```powershell
gh auth login
gh auth status
git clone https://github.com/<owner>/<repository>.git <checkout-path>
git -C <checkout-path> remote get-url origin
```

Create a revocable GraphGoblin API key with exactly the **runs:read** scope. Save its value in **Settings → Secrets** under the name **supportReadKey**. The template asks for the secret name only; never paste the key value into the form, a prompt, a pull request, or a run note. This key is separate from GitHub CLI authentication. See [Settings and secrets](06-settings-and-secrets.md).

The reviewer and fixer role menus use current enabled models and harness preflight. The gallery chooses an enabled Codex model and supported effort when available; Claude choices appear only when the installed harness, login, model, effort, and required execution policy are supported. The reviewer uses read-only access. A fixing pass uses a separate fresh session with write access. These settings do not install a harness or change its billing account.

## Configure and create the review workflow

On **Loops**, choose **New from template**, then **Use GitHub PR review**. The repository identity is blank so you can enter the exact target. The support key name is supplied by the manifest and is read-only in the form.

| Setting                                           | Default and effect                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout path, repository owner/name, base branch | Identify the existing canonical clone and the one repository/base branch to review. Pull requests must target this base branch and have both head and base in the same repository.                                                                                                                                      |
| Reviewer and fixer model/effort                   | Select currently enabled catalog entries accepted by preflight for each role. The reviewer is read-only; each fix uses a fresh fixer session.                                                                                                                                                                           |
| Check program, arguments, timeout                 | Defaults to `pnpm` with the single argument `check`, and 600 seconds. Arguments are passed as separate literal values, one per line; shell operators and quoting are not interpreted. Timeout range: 1–86,400 seconds.                                                                                                  |
| Require a human choice before every merge         | Off by default. When enabled, a successful reviewer verdict waits for a human decision. A matching label from **Labels that require human review** also requires this wait when the pull request has one linked issue.                                                                                                  |
| Labels that require human review                  | Empty by default. Enter one existing linked-issue label per line. A matching label requires a human choice. A pull request without a linked issue has no issue labels to check.                                                                                                                                         |
| Needs-human label                                 | Defaults to `needs-human`. It is added to a linked issue when a person closes without merging or when the human wait times out. Ensure the label exists if you want that issue update.                                                                                                                                  |
| Additional trusted authors                        | Empty by default, up to 100 GitHub logins. An empty list uses GitHub's current repository permission check; configured names are additional trusted authors. Explicit bot logins such as `dependabot[bot]` are supported; the suffix alone grants no trust.                                                             |
| Required checks                                   | Defaults to **Use repository protection rules**. Alternatively, enter explicit check names, one per line. An empty explicit list means that no named CI checks are required by this template; it never guesses names from checks that happen to be missing. Ordinary GitHub protection and merge readiness still apply. |
| Merge method                                      | Defaults to squash; choose merge commit, squash, or rebase. GitHub permissions and current protection determine whether GitHub accepts it.                                                                                                                                                                              |
| Automatic review cycles                           | Defaults to 3; range 1–3. Bounds the configured automatic review/fix work.                                                                                                                                                                                                                                              |
| Additional human-requested cycles                 | Defaults to 3; range 0–3. Each accepted extra cycle allows one fixer pass followed by another review.                                                                                                                                                                                                                   |
| Human reminders                                   | Defaults to 3; range 0–3. After these bounded reminders, an unanswered human wait times out without merging.                                                                                                                                                                                                            |
| Hours before a reminder                           | Defaults to 24; range 1–168 hours.                                                                                                                                                                                                                                                                                      |
| Minutes to wait for checks                        | Defaults to 30; range 1–120 minutes.                                                                                                                                                                                                                                                                                    |

Choose **Check requirements** after filling the settings. It checks both selected roles against the current catalog and harness preflight, verifies the repository root and matching GitHub origin, checks GitHub CLI authentication and repository discovery, checks that the saved secret belongs to the current owner and has exactly `runs:read`, and verifies that the matching packaged support entry is installed.

This report does not check that your issue labels exist, that a configured branch-protection rule or explicit check name is correct, or that GitHub will grant every later operation. It does not infer required check names from absent checks. Runtime review and merge steps recheck the current pull request, exact head, checks, native merge readiness, and ordinary permissions. If a setting changes after the report, check again before creating the draft.

**Create draft** creates a distinct template instance with a draft parent. It does not publish the parent or start a run. Review the graph and settings, then publish the parent when you are ready to enable its scheduled pull-request poll. Publishing enables the configured review flow and can lead to ordinary merging when the conditions below allow it; it does not create a GitHub approving review or bypass repository rules.

## Understand which pull requests can be reviewed

The published parent polls every 60 seconds and admits at most one candidate per poll. It looks for open, non-draft pull requests targeting the configured base branch. Before work proceeds, the pull request must have the configured repository as both its head and base repository, and the author must either be listed in **Additional trusted authors** or have current write, maintain, or admin permission in that repository.

There is no manual issue or pull-request picker. A pull request can be reviewed without a linked issue. If exactly one same-repository issue is linked, the workflow may use its labels for the human-review rule and may update that issue after a human close or timeout. With no linked issue, those issue-only actions are skipped. Multiple linked issues or a link to another repository fail closed.

The configured gate runs on the exact candidate head before the reviewer. If checks do not become ready within **Minutes to wait for checks**, the workflow cannot merge that head. The reviewer receives the prepared head read-only and returns a structured approval or change request. That verdict is workflow evidence, not a GitHub review approval.

If the reviewer requests changes and the automatic-cycle budget allows it, a separate fresh fixer session can make a bounded change. The workflow reruns the gate and required checks on the new exact head before asking the reviewer again. The fixer cannot merge or change GitHub state; trusted support reconciles and pushes its result. If a reviewer approves and no human choice is required, the workflow may use the selected ordinary merge method only after the gates pass and GitHub reports the exact head ready. A required human choice pauses before that merge.

At a human wait, choose **merge**, **another cycle**, or **close** through the run inspector, the run-input API, or MCP `provide_input`. **Another cycle** is available only while the configured extra-cycle budget remains and performs one fixer pass followed by another review. At the cap, only **merge** or **close** is offered. Merge still requires the current exact head, passing gates, configured checks, GitHub's current merge readiness, and normal permissions. Close leaves the pull request unmerged.

Each wait is bounded by **Hours before a reminder** and **Human reminders**. If no human decision arrives before the final timeout, the run fails with `HUMAN_REVIEW_TIMEOUT`; it never merges on timeout. When there is one linked issue, the configured needs-human label is applied for a timeout or a human close without merging.

## Rotate the support key and recover safely

The support key also authenticates the review journal stored with the repository worktree. Rotate or revoke it when no review run is active or waiting for a human. If it is compromised, revoke it promptly. Preserve the affected run and its repository worktree for manual reconciliation; changing the key can prevent later calls from authenticating that journal.

A pull-request head is reserved after the review is admitted. Heads pushed by the fixer also remain consumed, including when the remote push succeeds but the run stops before recording the final step. Recovery checks the signed journal against the original run and the exact recorded fixer visit; missing or changed proof requires manual reconciliation. If the claim is refused before a workspace exists, the run preserves that original refusal and stops. A terminal failure does not provide a generic reset or a safe retry button for that same consumed head. Preserve the run, its journal, and its worktree; reconcile the pull request and repository state manually before deciding what to do next. If the author pushes a new head, it is a different candidate, but do not use that as a substitute for reconciling an earlier uncertain effect.

## Understand the execution boundary

The support code validates the repository and keeps its review worktree and journal under the configured clone. That does not create an operating-system sandbox for the GraphGoblin API or the configured gate. The gate is a native process running as the API account and can access files that account can read. The model harness's execution policy is not a substitute for OS isolation. Use an API account and host whose file access is appropriate for the repository and gate you configure.
