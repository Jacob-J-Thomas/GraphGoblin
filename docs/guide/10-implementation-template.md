# Start an implementation workflow

On **Loops**, choose **New from template**, then **Use GitHub issue implementation**. GraphGoblin creates an independent editable loop and opens it immediately. There is no settings form or repository URL to enter in the gallery. See [Start from a template](09-templates.md).

The starting graph plans a task, implements a focused change, and verifies it with a bounded repair loop. Supply the task, acceptance criteria and relevant repository context in the run input, or customize the graph's instructions and variables in the editor. Configure the loop's working directory when it needs a local checkout. Model and effort selections can inherit normal defaults or be set on inference nodes.

Review the inference nodes, verification steps, repair conditions and iteration limits before publishing. These are ordinary editable loop values; the gallery does not provide a separate gate, label or budget form. Creation neither publishes the loop nor starts a run. Publish after validation, then start work through **Runs** and follow the evidence in the run inspector.

This copy does not poll GitHub issues, install published worker loops, open pull requests through privileged template support, or apply repository labels automatically. Add any needed trigger or integration through ordinary loop authoring. Configured template instances and their privileged GitHub automation are being retired separately in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165).
