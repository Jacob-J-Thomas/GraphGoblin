# Start from a template

On **Loops**, choose **New from template**, then the green **Use &lt;template name&gt;** button on a card. Each card offers this one action beside its description and tags. GraphGoblin immediately saves a draft and opens it in the editor. There is no setup form to complete first.

Each template supplies a useful starting graph, instructions and limits. The starter assistant summarizes input; the implementation workflow plans, implements and verifies a task; the review workflow reviews and requests bounded fixes; the QA workflow assesses evidence and asks an adversary to challenge it. Every use creates a new, independent normal loop. Use the same template as often as you like, then name, configure, publish and run each copy separately. Editing one copy never changes another copy or the catalog template. Change nodes, instructions, limits and connections just as you would in a loop you made yourself.

The prompts use the run's input and existing context. Supply the task, repository or pull-request details when starting a run, or make the instructions and variables specific to your project in the editor. To work in a local checkout, configure the loop's working directory. Missing repository details are not replaced with a guessed owner or URL. Model selections can inherit your configured defaults; choose a model or harness in the editor when you want a specific role assignment. Creating a draft does not require a connected model account or GitHub credentials.

Creation does not publish the loop or start a run. Each new use creates a separate draft; while creation is pending, repeated activation cannot submit another request. If a draft was created but the editor could not open, choose **Use &lt;template name&gt;** again or the alert's **Open the created draft** link to open that same loop without creating another copy. If creation fails, GraphGoblin shows an error and refreshes the loop list; after a timeout, check that list before trying again. Review the graph and its validation messages, publish when ready, and start it through the usual run flow.

## Customize the copied loop

The gallery has no settings form, repository or GitHub URL field, automation action or readiness checks. Set any needed values in the ordinary editor after copying. See the [implementation](10-implementation-template.md), [review](11-review-template.md) and [QA](12-qa-template.md) guides for what each starting graph does.

The QA starting point is an editable assessment workflow. Its model output is not authenticated proof of a GitHub merge. Configured template instances and their privileged GitHub automation are being retired; their backend removal is tracked separately in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165). Existing bound QA parents retain their isolation warning while that backend remains. Ordinary copies do not carry that binding or warning.

Templates use the existing context and session behavior. Per-node session continuity and question-context redesign remain deferred.
