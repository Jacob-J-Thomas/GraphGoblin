# Start a QA assessment workflow

On **Loops**, choose **New from template**, then **Use Post-merge QA**. GraphGoblin creates an independent editable loop and opens it immediately. The gallery asks for no settings, repository URL, role selection or prerequisite check. See [Start from a template](09-templates.md).

The starting graph defines acceptance criteria, assesses supplied evidence, and challenges the result with an independent review. Provide the subject, criteria and evidence in the run input, or customize the prompts and variables in the editor. Choose the inference nodes' harness, model and effort or inherit normal defaults. Review the assessment steps, stopping conditions and iteration limits before publishing, then start the loop through **Runs**.

This is an ordinary assessment loop. Its model output is not authenticated proof of a GitHub merge. It does not automatically discover merged pull requests, create proof branches, reopen issues, relabel work or invoke privileged template support. A fresh model session or read-only role alone does not establish an operating-system isolation boundary.

Ordinary copies have no template-instance binding and do not receive the configured QA-parent isolation warning. Existing bound QA automation retains that warning while its backend remains: enforced evidence-only isolation is unavailable, and publishing a bound parent can arm polling and consume permanent attempts. Configured instances and their privileged GitHub automation are being retired separately in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165); copying this starting point does not enable them.
