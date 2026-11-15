# Space cards — initial native evidence

This packet preserves the initial six-group native run for the Space cards behavior. The primary handoff is the byte-preserving [handoff copy](evidence/source/handoff-native.md.txt), SHA-256 `5060eea5787c5dbc573d1de948330d04483e219301788db9f29dc1d4e4e546bb`. Source copy hashes and paths are in [raw-copy-manifest.json](raw-copy-manifest.json); the isolated Turbo cache and byte-identical source copies are mapped in [omissions.json](omissions.json).

## Scope and result

All six admitted groups passed on their first combined stack: 174 evidence checkpoints and 29 browser draft PUTs, with zero fixture-correction batches and zero uncaught page errors. The six group records are linked below. This evidence qualifies the specified behavior on the frozen stack; it is not formal adversarial review, later #207 integration verification, final-main sign-off, or owner acceptance.

| Group               | Checkpoints / PUTs | Full raw result                                                              |
| ------------------- | ------------------ | ---------------------------------------------------------------------------- |
| Desktop apply       | 33 / 6             | [result](evidence/source/runs/apply-d1-initial/raw/0071-full-result.json)    |
| Desktop gestures    | 41 / 4             | [result](evidence/source/runs/gestures-d1-initial/raw/0068-full-result.json) |
| 768 px              | 60 / 14            | [result](evidence/source/runs/n768-initial/raw/0122-full-result.json)        |
| Coarse dark touch   | 13 / 1             | [result](evidence/source/runs/touch-d2-initial/raw/0022-full-result.json)    |
| 512 px, DPR 2       | 13 / 1             | [result](evidence/source/runs/double-r512-initial/raw/0021-full-result.json) |
| Device and conflict | 14 / 3             | [result](evidence/source/runs/device-d1-initial/raw/0031-full-result.json)   |

The initial double-click evidence was scoped to the center of the Space target. The alternate R512 sample at `(93, 290)` recorded hit geometry only; no click was sent there in this run. The later off-center double-click failure is preserved separately in the supplemental packet, not blended into these first-pass results.

## Candidate, build, and integrity

The candidate was merge commit `5c80b06f6861b41e0177cd9def89334ab0c7858d`, tree `77d7b6472a1df9dfa967be1ffa1632aa7ca3fb6c`. It joins the Space cards parent `393db93d90d8642ee52c18a84ce51537d4c60e43` with the integrated history and reference fixes parent `8991be35fd50c6ab9a1d5eee51b124b70f0eabc7`. The parents share historical merge base `8215514281fd84bf08839c5ad4875d018ccadd28`. The observed `origin/main` was `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9`. One forced `pnpm.cmd build` under Node 22.23.4 passed all 12 tasks with zero cache hits. The before/after binding checked 1,513 source files and 1,227 generated files in 13 trees; both bindings and both Git identity records are byte-identical. The source reports identical domain JavaScript before/after and a map linking the exact checked TypeScript source path. See [build log](evidence/source/forced-build.log), [build result](evidence/source/forced-build-exit.json), [identical before/after binding copy](evidence/source/binding/binding-after.json), [after binding](evidence/source/binding/binding-after.json), [identical before/after domain copy](evidence/source/domain-after.json), and [identical Git identity record](evidence/source/git-after.json).

The cleanup audit reports zero remaining owned processes, listeners, disposable stores, SQLite files, lock/WAL/SHM sidecars, or unqualified PID matches. See [cleanup record](evidence/source/cleanup-verified.json). The original native evidence hash inventory is preserved at [native-evidence-SHA256.txt](evidence/source/native-evidence-SHA256.txt).

## Preserved evidence and limits

The packet retains all six run and observation records, all 20 raw frame JSON files, all 10 PNG screenshots, six browser/console log pairs, and all distinct driver versions. Six page snapshots were generated; exact-byte duplicate copies are mapped in `omissions.json`. Raw event, frame, action, screenshot, snapshot, and command evidence is copied byte-for-byte where present.

The source inventory contained 539 files / 14,578,202 bytes. The packet retains 416 unique exact copies / 5,004,716 bytes. It omits the 30-file isolated Turbo cache (6,733,358 bytes) and 93 byte-identical copies (2,840,128 bytes), each mapped to a retained path and SHA-256. No database, key material, or model-stream paths were present in the selected source inventory. Original source files remain untouched.

`SHA256SUMS.txt` covers all packet files other than itself. `.gitattributes` marks copied evidence as binary so Git does not normalize line endings.
