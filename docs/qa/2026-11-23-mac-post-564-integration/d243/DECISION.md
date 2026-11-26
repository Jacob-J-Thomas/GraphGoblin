# D243 — Place the unisolated startup fixture on hosted CI

Coordinator decision under the owner's delegated blocker authority; consolidated owner accept/rework remains pending. This decision controls the location of the next Mac integration checks. It does not approve the Mac product, complete any test, or change a repository gate.

For the post-564 integration, run the planned local API selection without `src/main.test.ts` on this shared Windows host. Retain that file in the unchanged full hosted unit/coverage suite and the native macOS API selection. Keep the remaining 11-file local API smoke selection, nine-file local web selection, normal static gates and build, subject to actual integrated-source and fixture admission. All current seven-job CI, coverage thresholds, native verification, independent review, actual Finder/Dock QA and signed merge requirements remain.

The bounded fixture inspection found that `apps/api/src/testing/api-subprocess.ts` removes inherited `GG_*` values and does not reconstruct `GG_OLLAMA_ENABLED=false`. The in-process startup case in `main.test.ts` similarly clears ambient configuration. Root then read `apps/api/src/config.ts`: Ollama defaults to enabled at `http://127.0.0.1:11434`; `container.ts` constructs that service and starts it during ordinary admission. This establishes a source-supported route toward the owner's protected listener, not an observed connection. Parent-only discovery settings would not support a claim that these local startup cases are isolated. The hosted runners are disposable and do not contain this owner's service; their complete ordinary startup results remain required.

The other selected startup fixture, `serve.test.ts`, explicitly disables Ollama and clears the Jev key. `main-entry.test.ts` checks inert import, source imports, configuration and identity without calling ordinary startup. Other named API fixtures use controlled adapters or owned temporary filesystem/process resources. The API port setup creates its lease directory beneath `os.tmpdir()` and removes it after workers close. The port helper briefly binds loopback and wildcard availability probes on Windows/Darwin; this is disclosed and is not described as a loopback-only/no-network execution.

Before local execution, bind the actual integrated head/build, materialized source/helper hashes, owned TEMP/TMP and lease roots, a nonowner candidate port range and child-only provider controls. Use the existing fixtures without source overlays, one worker and zero retries. Preserve actual platform skips, cleanup results and any failure. Neither these Windows fixtures nor hosted native evidence replace the outstanding Mac device observations. No local test has run under this decision yet.

Alternatives declined:

- Running `main.test.ts` locally with only a parent `GG_OLLAMA_ENABLED=false`: the helper demonstrably drops that setting.
- Changing or redirecting the owner's Ollama service, credentials, listener or machine network policy: outside this integration and unnecessary.
- Patching the shared fixture solely to make this one local run possible: adds a separate test-harness change and another reviewed source to an otherwise bounded integration; the unchanged fixture already runs on mandatory disposable hosted runners.
- Omitting ordinary-startup coverage entirely, disabling a CI step or lowering coverage: rejected; hosted coverage and native Mac startup checks remain unchanged.
- Describing Windows skips, source reasoning, wildcard probes or hosted native processes as completed device GUI acceptance: rejected; evidence tiers stay separate.

Inputs: [bounded fixture report](../mac-post-564-fixture-admission-preparation-01/REPORT.md), [fixture source pins](../mac-post-564-fixture-admission-preparation-01/SOURCE-PINS.json), and root's additional config/container/Vitest setup/main-entry readback at clean Mac head `4690b5493390df6bac8ba16cadfd23a1c56bc6ca`. Rebind these exact paths after the actual signed PR564 integration before execution. This supersedes only the unexecuted preparation's local 12-file API command; it leaves the full hosted command and all acceptance criteria intact.
