# Retained fixture repairs

## Public attempt 1

The initial REST request supplied `allowDraft: true` without `versionId`. The route selects an explicit version ID or the current published version; allowDraft only permits a selected draft. The un-published loop correctly returned 404 LOOP_NOT_FOUND before the first run. This is a QA fixture error, not a #364 defect. Attempt 1 has six setup/cleanup checks and one fixture error; it establishes none of the intended run behaviors.

Attempt 2 adds the created draft's exact ID to the start request. No product source changed and no expectation about process failure classification changed. The entire original script, transcript, stdout/stderr, environment and observations remain retained. Attempt 1's own server and recorded fake-CLI PIDs are absent and its ephemeral listener was released.

## Controlled lifecycle assertion

The first controlled matrix produced 19/20 passes. Its sole failed predicate used `(result.code ?? result.name)` to identify cancellation. The actual result was `{name: "AbortError", code: 20, message: "Claude turn cancelled"}` with no harness diagnostic event, which correctly gives cancellation precedence. A DOMException has a legacy numeric `code` as well as its `name`; this assertion incorrectly compared numeric 20 with the expected name. The original script/log/observations remain intact. A bounded fresh rerun of just this case uses `name === "AbortError"` and checks that no configuration-failure event displaced cancellation. No product code changes, broad matrix reruns or changed behavior expectations were involved.
