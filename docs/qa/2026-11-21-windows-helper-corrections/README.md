# Windows helper ownership: D166 correction evidence

**Mechanical public-archive staging.** This packet now includes the completed independent
candidate QA. Corrected-head hosted CI, corrective review, the final general scan, owner decision
review and owner QA remain pending. Staging grants no merge or owner-acceptance permission.
Intended repository path: docs/qa/2026-11-21-windows-helper-corrections.

| Identity         | Commit / tree                                                                       |
| ---------------- | ----------------------------------------------------------------------------------- |
| Held baseline    | 2164cd11624c88d66ae64d1ac86ae26505a6c1ea / 0b1a84d1c881518b4744e2565a2874ec481921fc |
| Corrected source | 37803eeef9f55c2a316289aa502798025a7873be / 647d297990837f7f21e0054c5be15a0109fab2f1 |
| Base             | 47ca4640793a81efa5bec661dba25627de314774                                            |

[D166](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7056880570) admits
only F3 (strict ownership JSON parsed once before Trim) and F4 (complete cleanup observation
credited only before 2,000 ms). Earlier lifecycle, privacy, identity and budget decisions remain.
#460 stays held; #543/#544 stay parked. The three-total general-scan budget is unchanged.

## Evidence lanes

| Lane                                               | Recorded result and boundary                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Independent held baseline](baseline/README.md)    | Actual Claude Code Opus 5.5 xhigh; parent verified terminal exit 0. 16 unique cases, 17 executions; authoritative mixed-version characterization: 9 conform, 7 violate. Six malformed responses reached the start path; one other malformed response refused with a wrong diagnostic. |
| [Author correction verification](author/README.md) | Separate author evidence: native group 9/9 including 30 protocol cases and six deterministic timing controls; focused recorder-module tests 40/40; build/static gates passed. Scoped coverage and native/source timing limits remain explicit. This is author evidence.               |
| [Independent candidate QA](candidate/README.md)    | Actual Claude Code Opus 5.5 xhigh; parent verified terminal exit 0 / success 1. Bounded PASS: F3 16/16 conform, 176/176 controls; F4 8/8 through the shared product timing seam; three grouped native modes 3/3. No setup correction or repeated frozen run.                          |
| Hosted CI and reviews                              | Fresh corrected-head hosted CI, corrective review and final general scan remain pending.                                                                                                                                                                                              |
| Owner acceptance                                   | Owner decision review, visual dialog QA and owner QA remain pending.                                                                                                                                                                                                                  |

The parent's completed candidate provider-final SHA-256 is
4ea2e0829a7f758271ce1ca6b8ca62d3c537d19a7fed9bc31e727b185699d54d.
The private provider transcript is excluded. The original candidate report's statement that no
provider or model turn was touched describes the application/provider fixtures. The QA itself
did run the genuine Claude session identified above; that original wording is preserved.

## Preserve the baseline and payload facts

- v1 executed all 16 cases. Its Q06 minimum of two producer samples was an incorrect timing
  assumption: one 3,375 ms sample was observed while substantive refusal, privacy and preservation
  controls held. Original v1 prediction/contract labels remain.
- v2 changed only Q06's minimum from 2 to 1 plus explanatory comments; maximum 60 and substantive
  controls stayed unchanged. Only Q06 was rerun with v2 on the baseline. The authoritative
  baseline characterization is 15 v1 observations plus one v2 observation, not a full v2 rerun.
  All 17 original execution records remain.
- Q08–Q13 were the six malformed baseline start admissions. Q15 refused with store-held instead
  of helper-invalid. Candidate observations corrected all seven while retaining the original
  baseline-prediction labels: 9 matched and 7 differed, all 16 conformed to the corrected contract.
- Q09's original report tables show decoded duplicate names as shorthand. The actual response
  is 37 bytes, SHA-256
  9fb5d4511478937a531fcb52fe399c2d424b54b50dae94afac971a4ea3da6889.
  The frozen JavaScript literal has two backslashes before u0061; its wire JSON key has one:

      st\u0061te

  That key decodes to state. See baseline/driver/v1/qa459i-cases.mjs line 146, v2 line 151, and
  candidate/runs/candidate-20261121T045534Z-624fab/cases/Q09.json. Original report/table bytes
  are unchanged; the shorthand is not relabelled a raw-byte quotation.

- Both baseline freeze corrections remain in baseline/driver/freeze-v1.json and freeze-v2.json,
  including original hand-typed errors in frozenUtcBasis. Corrected times are 04:29:34.002Z and
  04:31:44.710Z; original values were 04:44:00Z and 04:36:30Z. No bookkeeping error was erased.

## Candidate reuse, freezes and evidence tiers

Candidate F3 reused the unchanged baseline v2 driver, manifest SHA-256
766811a8076395f172127dea170220b8827b009ef828de26678d8768a178076e.
It is available once at baseline/driver/v2 and is not duplicated or executed by archive staging.
Candidate F3 ran all 16 cases once. Only valid Q01–Q04 reached the controlled start path.
A fixture marker and launcher-observed exit 54 establish start-path admission, not readiness or
actual store mutation.

The original candidate F4 freeze was written at 05:05:06.279Z, before its 05:05:13 run;
the native freeze was written at 05:05:06.559Z, before its 05:05:30 run. Their source manifests
are preserved at candidate/sources/f4/v1 and candidate/sources/native/v1. F4 manifest SHA-256:
344e792473c451429c0d255fe139020c3c5b653a9f39b10e8d3c3308a462bb51.
Native manifest SHA-256:
e38df2c3c19d61fe59f4b5df46258554ef04bbc9e9ecb4ec57f705ad4ce6d75a.
All three pre-freeze compile-only attempts remain, including two failures; none executed the
pre-check assembly. The frozen extensions were unchanged after execution.

F4's eight observations test the actual shared AwaitCleanup method, including equality, late
completion, a deadline-crossing observation and a real Stopwatch delay. They are decision-method
evidence. Production refusal mapping, retained held guidance after unconfirmed cleanup,
pending-I/O transfer and job/disposal ordering remain source-integration evidence, as the
candidate acceptance map states. No unconfirmed kernel-cleanup branch, race or fault experiment
was performed. The baseline F4 evidence remains source-only.

The three native entries are grouped maintained NativeChecks modes, rather than the whole
node:test parent suite. They add narrow confirmed-cleanup integration observations. No GUI,
MessageBox pixels, owner gateway, owner store, cold WMI, shortcuts or installer acceptance is
established here. The old 31-criterion matrix, prior full-local-check nonpasses, C14 and
C25–C31 LIMIT entries, source/Prettier timing boundary, focused coverage denominator and unchanged
90% thresholds remain as recorded. No aggregate green upgrades an uncovered criterion.

## Byte preservation and Markdown reading copies

Stage01 remains unchanged. Stage02 extends its verified baseline/author subtrees with the
completed candidate public subset: 62 baseline, 8 author and 57 candidate original files.

| Original subset manifest    | SHA-256                                                          | Entries |
| --------------------------- | ---------------------------------------------------------------- | ------- |
| baseline/MANIFEST.sha256    | 7579fc339d8e5de65559cb6400b78454d3ce7a55bfe0fd8566eb1f01a7b31905 | 61      |
| author/MANIFEST-SHA256.json | 4f58e75a8a1a11ba5b704fd402cce798d28a8e169be27385faf624ede01c6728 | 7       |
| candidate/MANIFEST.sha256   | a5be0e6ed5142a357c433b1b0b48d9715fecdade0a513dc74a9ab229ed912637 | 56      |

All raw JSON, executable source, logs/projections and original manifests remain byte-identical.
Every source Markdown file has a sibling .original.txt made before formatting its .md reading
copy. The provenance map records exact source-to-original and source-to-published paths, sizes
and hashes. Formatted reading copies are never labelled originals.

For original manifest replay, resolve Markdown paths to the mapped .original.txt. In each
frozen driver/extension manifest, README.md resolves to README.original.txt. To restore a frozen
driver, materialize only manifest-listed original files under their original names in an empty
disposable copy, plus the unchanged manifest as needed. Do not include reading-copy bytes or
archive extras as frozen inputs. Historical descriptors can name private assemblies and
unsanitized setup/build-record.json; public scrubbed records are projections, not original-byte
substitutes. No restored driver or newly generated manifest was executed here.

## Privacy and administrative scope

Only the supplied public subsets are attached. Binaries, private raw cases and provider logs
are excluded. Generic Windows compiler paths and retained pre-freeze compiler-error paths are
documented non-owner locations. Runtime roots use placeholders. Four frozen drivers retain the
literal account-name scrub regex so their executed source bytes remain verifiable; this packet
does contain that narrow source literal. No owner home/checkout path or credential material is
authorized by that preservation.

The prior combined documentation-write/formatter action was rejected before process creation
with only “blocked by policy”; its reason is unknown. An explicit one-file Markdown patch and
separate formatter were accepted for the same authorized administrative scope. No composition,
length or permission cause is inferred. This is not product QA or authorization for rejected
native/GUI work, and all #471/GUI restrictions remain. No experiment or driver was run for staging.

The root evidence-manifest.json excludes itself and inventories this stage. Later CI/review
attachments require updated status, provenance and inventory; they must preserve all originals.
No repository, index, commit, push or GitHub state was changed by this staging task.
