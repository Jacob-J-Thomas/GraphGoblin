# Start a review workflow

On **Loops**, choose **New from template**, then **Use GitHub PR review**. GraphGoblin creates an independent editable loop and opens it immediately. There is no gallery settings form or repository URL to enter. See [Start from a template](09-templates.md).

The starting graph reviews a supplied change, applies focused fixes, and reviews again within a bounded cycle. Supply the change, review criteria and repository or pull-request context in the run input, or customize its instructions and variables in the editor. Set the loop's working directory for a local checkout. Choose harness, model and effort on the inference nodes or inherit your normal defaults.

Inspect the review prompts, fix steps, stopping conditions and iteration limits before publishing. They belong to the copied loop and can be edited like any other graph. Creation does not publish or run it. Publish after validation, then start it through **Runs** and inspect the review evidence there.

A model's review is workflow evidence; it does not submit a native GitHub approval or authorize a merge. The copied graph does not poll pull requests, apply labels or perform privileged template merge actions. Configure any needed trigger or integration through ordinary loop authoring. Configured template instances and their privileged GitHub automation are being retired separately in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165).
