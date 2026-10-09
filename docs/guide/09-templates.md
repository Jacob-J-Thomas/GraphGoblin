# Start from a template

On **Loops**, choose **New from template**, then **Use** on a template. GraphGoblin immediately saves a draft and opens it in the editor. There is no setup form to complete first.

Each template supplies a useful starting graph, instructions and limits. The starter assistant summarizes input; the implementation workflow plans, implements and verifies a task; the review workflow reviews and requests bounded fixes; the QA workflow assesses evidence and asks an adversary to challenge it. Every use creates a new, independent normal loop. Use the same template as often as you like, then name, configure, publish and run each copy separately. Editing one copy never changes another copy or the catalog template. Change nodes, instructions, limits and connections just as you would in a loop you made yourself.

The prompts use the run's input and existing context. Supply the task, repository or pull-request details when starting a run, or make the instructions and variables specific to your project in the editor. To work in a local checkout, configure the loop's working directory. Missing repository details are not replaced with a guessed owner or URL. Model selections can inherit your configured defaults; choose a model or harness in the editor when you want a specific role assignment. Creating a draft does not require a connected model account or GitHub credentials.

Creation does not publish the loop or start a run. Each click creates a separate draft; while creation is pending, repeated activation cannot submit another request. If a draft was created but the editor could not open, use **Open draft** to open that same loop. Review the graph and its validation messages, publish when ready, and start it through the usual run flow.

## Configure repository automation when needed

Repository templates also offer **Configure automation**. This optional action opens the settings and prerequisite checks for a repository-bound workflow that can poll GitHub and perform the configured actions. It creates a separate automation instance, with published child versions and an unpublished parent. It does not convert or overwrite a draft you have already edited.

For this automation path, **Check requirements** checks the values currently shown. After changing a setting, check again. **Create draft** repeats the checks on the server. A requirement can block this configured creation or only execution; its message explains the remedy. See the [implementation](10-implementation-template.md), [review](11-review-template.md) and [QA](12-qa-template.md) automation guides.

The general QA starting point is an editable assessment workflow. Its model output is not an authenticated proof of a GitHub merge. The configured post-merge QA automation still requires production evidence-only isolation, which remains unavailable; creating a starting point does not enable that automation or bypass its refusal.

Both paths use the existing context and session behavior. Per-node session continuity and question-context redesign remain deferred.
