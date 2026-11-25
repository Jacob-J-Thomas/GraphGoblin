# Independent D238 canonical-path correction QA

**Bounded causal comparison passed.** On one real owned Windows Junction, the exact parent test failed solely at its original line 239 aliased database-lock expectation. The corrected test then passed every original assertion against the same built entry. No production or assertion relaxation was needed. This establishes the alias cause and narrow test correction on Windows; actual Darwin and full Mac acceptance remain separate.

The frozen candidate is `b7a7bbd83b3ae542f07e432d65ba04483493b57f`, tree `baa8eb9067e1612f568827b743da9050d49d6a6e`, parent `504afbc6d799aa21b16158248ade424783ecc2ce`, in root-created `G:/ggq/gg-mac-d238-alias-qa/GraphGoblin`. The immutable commit delta contains only `apps/api/src/main.test.ts`. Its SHA-256 remains `637998c1f8b332379d0844107fa04735a918c6140c99b4864cb7b5c570db5c80`.

The sole repository overlay, `apps/api/src/main.d238-parent.independent.qa.test.ts`, is byte-identical to the exact parent blob: `e7474752b74784044d88bc09c04dffbe680a0f94529f62eb1ef90f98a4b3829a`. Relative imports are unchanged. `SOURCE-IDENTITY.json` verifies that adding realpath to the import and applying it to the existing lock expectation are the only two substitutions; all other assertions/fixture bytes remain identical.

## Actual outcomes

| Invocation | Active result | Other cases | Disposition |
| --- | --- | --- | --- |
| `10-parent-negative` | Zero active cases, exit 0 | 1,837 filtered/skipped across 109 collected files | Runner-selection failure; not a pass or negative-control evidence |
| `11-parent-negative` | One exact shared-database case fails at unchanged line 239, exit 1 | 20 filtered/unexecuted in that one file | Expected causal negative: alias expected, physical path received |
| `12-corrected-positive` | The same named case passes, exit 0 | 20 filtered/unexecuted in that one file | Corrected positive; all original assertions complete |

The first Windows command's nested spaced-name quoting split the filter into additional positional file filters. Original command, streams and JSON are retained. Only CLI whitespace encoding changed to a no-space `\x20` regex; JSON then confirms exactly one target file and one active full test name in each actual invocation. No test had executed in the first attempt. No behavioral retry, deadline/threshold change or additional test was used. The original 60-second case/cleanup declarations and inherited forks/configuration remain unchanged; `--maxWorkers=1 --retry=0` were used.

The negative actually expected `.../alias/gg-api-process-rsUhiu/shared.db.graphgoblin.lock` while the real gateway reported `.../physical/gg-api-process-rsUhiu/shared.db.graphgoblin.lock`, with the existing ownership explanation. The corrected positive completed the named-resource, one-line/control-character, blank-stdout, original directory/database record preservation, contender-directory release and authenticated existing-owner HTTP 200 assertions. It is not graceful-signal lifecycle evidence: the original fixture force-stops its own owner handle during cleanup.

Both worker receipts identify the exact same built main.js SHA-256 `77340d74ad07bebe5875984fee0c92cbeac57afff13585a9bbe7fb3ab62c219c`, before/after each invocation. The actual worker os.tmpdir and both actual fixture mkdtemp paths used the alias; realpath resolved them to the distinct owned physical target. Each invocation used fresh stores. Coordinator/build TEMP/TMP stayed outside this control; both workers restored their original values.

## Isolation, resources and commands

D238 and the explicitly admitted D239 amendment control this packet. Before testing, source showed that the unchanged fixture strips inherited GG_ flags and otherwise starts default Ollama discovery. Only the exact real Node/built-entry children, after owned directory and loopback-port validation, received cloned options/env with `GG_OLLAMA_ENABLED=false`. All other executable/arguments/options/env values and actual spawn results were retained. This identical one-property control is recorded on all six actual API children. It prevents that configured automatic discovery path; no packet trace or universal network-absence claim is made. The prior author's unmodified focused run had no retained network trace and cannot establish that port11434 was never contacted. No owner provider service was inspected or changed.

Across the two actual cases, six direct API child handles have original close receipts: two key CLIs exit 0, two refused contenders exit 1, and two owners close with the fixture's SIGKILL cleanup. Native owner-record creation identities are retained for the two serving owners. No PID enumeration/kill was used for cleanup; the existing fixture used only its original returned child handles. Neither keys, full environment nor raw key CLI output were logged.

All four actual fixture directories were absent at worker closure. PowerShell reverified the same Junction/type/resolved target, removed only the link with nonrecursive Directory.Delete, verified the physical target survived that operation, then removed only the contained verified physical/scratch root. `CLEANUP.json` records alias, target and root absent. No old QA, owner store, unrelated process or device was modified. The initial zero-active command's coordinator/descendant diagnosis was read-only; its snapshots were not promoted to a universal process/network inventory.

Every install/build/check/test has actual original stdout/stderr and exit receipts. Fresh frozen-offline install reused 801 packages/downloaded 0 and ran the two esbuild postinstall scripts. The one repository build passed 12/12 tasks with 0 cached. Complete API typechecking, both external runner syntax checks, immutable source comparison and the later source qualification passed. No `--minWorkers`, timeout increase, fake canonicalizer/process result, production fix, new CI run or general review scan occurred.

## Source/index preservation and sparse qualification

`PARITY.json` is retained unchanged, including its first `omissionsOnlyDocsQa=false` flag. Exactly five missing *raw labels* were Git C-quoted docs/qa paths containing UTF8 octal apostrophes; the literal StartsWith predicate did not recognize their leading quote. `PARITY-QUALIFICATION.json` and original `GIT-PATHS.z` establish the decoded result independently: 42,519 tracked paths comprise 1,838 non-QA paths, all physically present with baseline/after/current hashes equal, and 40,681 docs/qa paths omitted by the unchanged sparse checkout. The docs/qa directory itself is absent. There is no missing non-QA path or materialized-source hash drift. The qualification lists all five original labels and decoded names; it does not erase the first flag.

Eight critical source files—main.test, main, api-subprocess fixture, canonical-path, data-dir-lock, container, config and Ollama services—each have equal actual/HEAD-blob/before/after SHA-256 values. Raw index remains `c69e70922d323f0f9d7898b43d04d2b3d72db8ec4f15a3e366458faafa79c990`; staged entries, skip-worktree entries, sparse rules, head/tree/parent and lock hash are unchanged, and common index is absent. Final repository status contains only the exact admitted parent-copy overlay. The 40,681 omitted paths were not materialized or verified as physical bytes; their omission is explicit.

The two full inventories stay in this external packet and its manifest. `INVENTORY-REFS.json` permits the repository archive to retain exact digest references plus parity summaries:

| Inventory | Bytes | SHA-256 |
| --- | ---: | --- |
| before.state.json |15480357|`5704807e71f1c648d43897c46d549fb497a602d4e6ddabfd437143a340d322c6`|
| after.state.json |15480424|`61d2b3d0b26df4205d41525e5ccff5a56d9faccef3826594c0791d81bcecb8ed`|

The remaining corrected-head/target complete seven-job CI, required native Swift/installer artifacts and coverage, actual Claude named correction review, reserved final audit, native Mac/GUI observations, signed delivery and owner acceptance remain root-owned and required. This packet does not reinterpret the original CI upload timeout or its monitor exit. Prior D236 and D237 QA remains frozen. No broader product or Mac acceptance is claimed.

Primary evidence: `RESULTS.json`, `SOURCE-IDENTITY.json`, both worker receipts, raw test JSON/streams/exit receipts, `ALIAS.json`, `cleanup-before.json`, `CLEANUP.json`, `PARITY.json`, `PARITY-QUALIFICATION.json`, `INVENTORY-REFS.json`, the immutable scripts and `MANIFEST.json`.

