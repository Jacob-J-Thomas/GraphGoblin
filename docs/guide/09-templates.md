# Start from a template

On **Loops**, choose **New from template**, then the green **Use &lt;template name&gt;** button on a card. Each card offers this one action beside its description and tags. GraphGoblin immediately saves a draft and opens it in the editor. There is no setup form to complete first.

Each template supplies a useful starting graph, instructions and limits. The starter assistant summarizes input; the implementation workflow plans, implements and verifies a task; the review workflow reviews and requests bounded fixes; the QA workflow assesses evidence and asks an adversary to challenge it. Every use creates a new, independent normal loop. Use the same template as often as you like, then name, configure, publish and run each copy separately. Editing one copy never changes another copy or the catalog template. Change nodes, instructions, limits and connections just as you would in a loop you made yourself.

The prompts use the run's input and existing context. Supply the task, repository or pull-request details when starting a run, or make the instructions and variables specific to your project in the editor. To work in a local checkout, configure the loop's working directory. Missing repository details are not replaced with a guessed owner or URL. Model selections can inherit your configured defaults; choose a model or harness in the editor when you want a specific role assignment. Creating a draft does not require a connected model account or GitHub credentials.

Creation does not publish the loop or start a run. Each new use creates a separate draft; while creation is pending, repeated activation cannot submit another request. If a draft was created but the editor could not open, choose **Use &lt;template name&gt;** again or the alert's **Open the created draft** link to open that same loop without creating another copy. If creation fails, GraphGoblin shows an error and refreshes the loop list; after a timeout, check that list before trying again. Review the graph and its validation messages, publish when ready, and start it through the usual run flow.

## Customize the copied loop

The gallery has no settings form, repository or GitHub URL field, automation action or readiness checks. Set any needed values in the ordinary editor after copying. See the [implementation](10-implementation-template.md), [review](11-review-template.md) and [QA](12-qa-template.md) guides for what each starting graph does.

Templates themselves are never runnable. `POST /templates/{id}/draft` copies a starting graph into a new owner-scoped ordinary loop with no template binding. Publish and run that copy through the normal loop API. The installed catalogue contains four manifests and four self-contained draft exports; prompts and output schemas are embedded in each graph. Manifests contain only `id`, asset `version`, `title`, `description`, `tags` and `draftFile`. Asset versions are independent of the loop definition format.

All four start manually, use ordinary nodes and return only to the caller. Their initial working directory is temporary. The shipped prompts prohibit commits, pushes, pull-request or issue changes, labels, merges and external services. Later automation requires explicitly authored ordinary nodes and the capabilities you configure. A model's assessment is not authenticated proof, and separate fresh sessions do not enforce evidence-only isolation. See [ADR-0030](../decisions/ADR-0030-templates-are-starting-points.md) and its runtime-retirement follow-up, [ADR-0034](../decisions/ADR-0034-retire-template-runtime-authority.md).

Templates use the existing context and session behavior. Per-node session continuity and question-context redesign remain deferred.
