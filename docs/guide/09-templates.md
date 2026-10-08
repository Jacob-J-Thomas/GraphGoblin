# Start from a template

On **Loops**, choose **New from template**. The gallery lists the templates bundled with this installation, their purpose and requirements. Choose **Use Starter assistant** to make a small loop that summarizes your input and suggests a next step.

Choose an enabled assistant model and a supported effort, then edit **Instruction** and **Maximum iterations**. Defaults come from your current model catalog. Missing or unavailable selections need attention before creation. Instructions are stored as text in the loop settings; they are not inserted into a shell command.

**Check requirements** checks the settings currently shown. After editing settings, check again. **Create draft** repeats the checks at the server and opens your new parent loop in the editor. Creation stays disabled while the request is running. If the draft was created but navigation failed, use the offered link to open that existing draft.

Creating a template does not start a run. Review the graph, publish it when ready, and start it through the usual run flow. Each creation makes a separate instance with its own loop IDs. For templates with children, children are published before the parent draft becomes visible, and the parent's subloops pin those child versions. A failed creation leaves no partial bundle.

A requirement can block creation or only execution. If execution is blocked, its message explains the missing capability and remedy; creating a draft does not bypass it. The initial catalog contains the starter assistant. Repository implementation, PR review and QA recipes are added only after their separate verification; they are not silently included as untested examples. Current production QA isolation is unavailable, so a future QA recipe cannot run by selecting an override.

Templates use the existing context and session behavior. Per-node session continuity and question-context redesign remain deferred.
