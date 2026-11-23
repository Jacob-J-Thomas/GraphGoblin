# W implementation case mapping

Author: bounded GPT-6.1 Sol xhigh worker. Base 02351e2fb932b3be44e7cc3fb3943a61d568226c, root-admitted shared checkout G:/ggq/gg-i4-486-authored-errors/GraphGoblin. Selected D188 revision03 A1/A2; consume core freeze-v1 without interface changes. This is author evidence, not independent QA or issue completion.

## B26 engine preparation and effects

| Case | Evidence test | Required observation |
| --- | --- | --- |
| Local parse/render/trimmed-empty | run-manager.test.ts, three table rows | Exact TEMPLATE_ERROR, script node, false, boundary/cause/correction; stored row matches run.failed; marker absent; actual Resume refused; zero resolve/write/dispatch/script calls. |
| Fixed/temp/template and trim | run-manager.test.ts, three table rows | WorkspacePort receives only two arguments and temp/fixed spec. Trimmed computed path identical. Script and terminal file delivery share one successful resolution; exact fake file bytes. |
| External same-class/name/code/object | run-manager.test.ts, four table rows | TemplateError, ExpressionError and lookalikes remain safe INTERNAL_ERROR/true with no authored boundary; zero dispatch, then actual Resume resolves again and succeeds after one-shot fault repair. |
| Cache after downstream failure | run-manager.test.ts | Successful directory stays cached across script exit-code failure/Resume; two script attempts, one fixed-spec resolve. |
| Terminal local bad/empty template | run-manager.test.ts, two rows | Explicit return payload reaches original receipt catch; succeeded run remains succeeded, exactly one return.failed and no run.failed/resolve/write; safe local text. |
| Terminal external resolve fault | run-manager.test.ts | Explicit return payload, unchanged external exception text in return.failed; succeeded terminal status, no run failure or file write. |
| Fixed/relative/temp adapter behavior | fs.test.ts direct FsWorkspace | Real directories, relative-to-absolute path, re-resolution reuse, real relative and absolute file bytes. mkdir failure preserves blocking file and succeeds after external repair. |
| Engine with real filesystem | fs.test.ts, four rows | Real fixed/relative/temp/trimmed-template paths and returned file bytes; one engine resolve; canonical physical journal use, only new temp claimed, repeated temp not re-claimed. Script and journal ports are controlled. |
| No native workspace effects | fs.test.ts, three rows | Real engine rejects bad/empty template before real OwnedRunResources: zero port calls, zero journal methods, empty disposable data root after failed run and refused Resume. |
| External journal rejection | fs.test.ts | Real directory exists before controlled journal TemplateError; INTERNAL_ERROR/true, zero dispatch/claim; successful Resume calls resolver/use again. Failed resolve is not cached. |
| Ownership and cleanup controls | history-cleanup.test.ts, existing tests | Updated direct callers retain disk-backed SQLite, positively owned deletion, retained shared/fixed use, canonical references, links/aliases, hard links, pre-existing resource, quarantine/large-store protections and short-name control. No sweep algorithm changes. |
| API retained-history fixture | apps/api/src/history-cleanup.test.ts | Fixture now supplies the fixed path already rendered by the engine: fixed version uses root; template version uses indexed path. Runtime API test remains pending root build/combined gate. |

## Required neighboring preservation updates

- FakeWorkspace tests cover only the frozen fixed/temp union and inspect recorded run IDs/specs.
- Ten existing selector helper calls now provide the frozen fourth AuthoredSite argument; successful built-in/expression cases are retained.
- Four existing invalid raw-coerce target cases in edge-cases.test.ts now assert selected B19 MUTATION_ERROR/false, output-transform ordinal 3 / operationIndex 2 / coerce / PATCH_ERROR cause / after-result phase and received-result copy. Exact row/event parity and refused Resume preserve one main invocation. The two valid target siblings still assert the actual successful patch and final thread.

## Evidence limits

Checks imported the evolving shared A/L implementation; W-owned source is separately hashed at handoff. These are supporting author checks, not a stable combined-source acceptance gate. Fake script execution and journal faults are identified above. Full numerical coverage, built API history suite, exact stable combined source/target verification and independent native/public/browser/restart QA remain root-owned gates. No new schema, contract format, export, dependency, migration, provider or test skip was introduced.
