# Configure post-merge QA automation

**Use Post-merge QA** creates an editable assessment workflow immediately. Its prompts use supplied context and evidence; it does not authenticate GitHub proof, reopen issues or enable the repository automation described below. This guide covers the optional **Configure automation** action. See [Start from a template](09-templates.md).

The post-merge QA template can be configured and saved as a draft. Its required evidence-only isolation is unavailable in the current runtime. Every QA run is stopped before repository checkout or a model turn, so this template cannot currently produce accepted QA evidence. No setting, label, or manual choice in the form overrides that block.

## Prepare repository access

Use an existing canonical clone of the repository. The checkout path, owner, repository name, and base branch must identify the same repository. The account running the GraphGoblin API needs the GitHub access required to inspect merged pull requests, their linked issue, and save the configured proof. Authenticate GitHub CLI for that account:

```powershell
gh auth login
gh auth status
git clone https://github.com/<owner>/<repository>.git <checkout-path>
git -C <checkout-path> remote get-url origin
```

Create a revocable GraphGoblin API key with exactly the **runs:read** scope. Save its value in **Settings → Secrets** under **supportReadKey**. The template form displays the required secret name only; never paste a key value into the form, prompt, issue, or proof. This key is separate from GitHub CLI authentication. See [Settings and secrets](06-settings-and-secrets.md).

The QA and evidence-only adversary roles use models and efforts from the current enabled catalog, subject to harness preflight. The gallery chooses an enabled Codex model with a supported effort when available. Claude appears only when its current harness preflight supports that model and effort. Where available, choose a different model or harness for the adversary to reduce shared blind spots. That choice is not an isolation boundary.

## Configure and create a draft

On **Loops**, choose **New from template**, then **Configure automation** on the Post-merge QA card. Repository fields start blank. The support credential field contains the manifest's required name and is read-only; enter credentials only in Settings.

| Setting                                       | Default and effect                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout path, owner, repository, base branch | Identify the existing canonical clone. The API checks the repository path and matching origin when checking requirements and creating the draft.                                                  |
| Support credential key name                   | Fixed to `supportReadKey`; the configured secret must have exactly `runs:read`.                                                                                                                   |
| QA and evidence-only adversary model/effort   | Selected separately from current catalog and harness preflight. The adversary receives a fresh session for its evidence review.                                                                   |
| Depth                                         | Defaults to **Standard**. **Full regression** selects the broader depth for every admitted issue.                                                                                                 |
| Full-regression issue label                   | Optional. When the linked issue has this label, the run uses full-regression depth even if the configured depth is Standard. Leaving it blank relies on the Depth setting.                        |
| Implementation trigger label                  | Defaults to `ready-for-implementation`. This must match the label used by the repository's issue workflow.                                                                                        |
| Dedicated proof branch                        | Defaults to `graphgoblin-proof`. It must be separate from the merged pull request's head branch.                                                                                                  |
| Program, arguments, timeout                   | Defaults to `pnpm`, one `check` argument, and 600 seconds. Each argument is passed as a separate literal value; shell operators and quoting are not interpreted. Timeout range: 1–86,400 seconds. |
| Unsound-evidence reruns                       | Defaults to 1; range 0–1.                                                                                                                                                                         |
| Rework requests                               | Defaults to 2; range 0–2.                                                                                                                                                                         |
| Issue reopenings                              | Defaults to 2; range 0–2.                                                                                                                                                                         |
| Proof push retries                            | Defaults to 3; range 0–3.                                                                                                                                                                         |

Choose **Check requirements** after entering the repository. The report checks the settings and current authoring requirements, including roles, repository/GitHub access, the exact-scope secret, and the packaged template support. It also reports that enforced evidence-only isolation is unavailable at run time. You may create a draft when the authoring requirements pass, but the report does not establish an eligible merged pull request or its one linked issue; those identities are checked at run admission.

**Create draft** creates a new instance. Supporting loops are published for the parent to reference; the parent stays a draft and is not polled until you review and publish it. Publishing starts the poll, which can select older eligible merged pull requests as well as new ones, at most one per poll; there is no initial cutoff. While isolation remains unavailable, each selected pull request creates a failed attempt before checkout or a model turn and permanently consumes its merge and linked-issue attempt. The workflow may also post one fixed explanation to the original linked issue. Keep the parent unpublished until an enforced isolation runtime is available. That comment is not a QA result, proof, or accepted pass.

The saved parent editor repeats this warning when reopened. A clean graph says **Graph ready to publish; QA execution blocked**: its validation does not establish runtime readiness. Publish remains available for a valid graph, so read the isolation and attempt-consumption warning before publishing. **Check requirements** keeps keyboard focus in the setup dialog while pending and after either success or failure; repeated activation cannot start another check while one is in flight.

## Understand the run and evidence boundary

An admitted QA attempt is tied to the configured repository, an exact merged pull request and merge commit, and exactly one linked issue in that repository. A generic requirements check cannot confirm those run-specific facts. The issue and merge identity remain authoritative throughout the attempt.

The QA graph asks its agent steps to use fresh harness sessions. GraphGoblin still passes structured run state and saved artifacts through the run's context thread; a fresh model session does not erase that state or start a new run. The evidence-only adversary is configured as read-only and receives a fresh evidence review, but the host currently has no enforced isolation runtime to keep it confined. Therefore the runtime refuses QA before checkout, model turns, proof creation, issue reopening, or relabeling. It may post one fixed explanatory comment on the original linked issue.

When an enforcing isolation runtime is available and independently verified, the configured QA scope can collect a proof snapshot and the adversary can assess that evidence. The designed proof links are immutable and tied to the exact merge and issue attempt, and the audit packet belongs on the original linked issue only. A model's assessment alone is not proof acceptance; no positive enforcement or accepted-proof behavior is available in this current runtime.

## Keep attempts bounded and recover uncertain work

The service permanently tracks ownership by merge and issue attempt. It does not replenish implementation attempts after exhaustion. The configured rerun, rework, reopening, and proof-push retry counts are limits, not guarantees that a retry is safe or that an issue will pass.

If a future enabled runtime reports an uncertain GitHub or proof effect, keep the run and its recorded evidence for reconciliation. Check the exact merged commit, issue state, proof branch, and issue audit packet manually before taking another action. Do not repeat an action whose result is uncertain or start a replacement attempt to bypass a consumed budget. Rotate or revoke the support key if it may be exposed; first account for active runs because removing it can prevent later support calls from authenticating.

## Understand the execution boundary

The adversary's read-only role and fresh session do not create an operating-system sandbox. The current runtime has no enforced evidence-only isolation, so QA stops before checkout or any harness turn. A fixed explanatory comment on the original linked issue may still be recorded. Keep the template unpublished until its limitation is understood, and do not interpret a no-turn refusal as evidence that an issue passed.
