# macOS launcher: current-main integration evidence

This records local integration candidate `e2161f5d9b13f6701929fa67ef77329d4bb98945`,
tree `d1122527ef7f884ddc908bf2b569887e2980589b`, with ordered parents
`6fe12f412cd74b034a77cde10a521bb319e8aa96` and
`0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`. At this evidence freeze, the candidate had not been published.
This archive records the checks preceding the draft PR update; it does not
accept Mac delivery. A separate metadata commit publishes these records.
[Decision](raw/mac-d237-integration-admission-01/decision-237.md) ·
[Freeze](raw/mac-d237-integration-freeze-01/freeze.json).

The lock composition retains main's typed release, reclamation and rollback
behavior and the launcher's optional opened-inode attestation through one primary
acquisition. The bounded documentation merge retains both parents' obligations,
the existing authenticated shutdown API and actual installer command. Original
Swift/AppKit, installer and old native QA objects are unchanged.
[Protected objects](raw/mac-d237-integration-freeze-01/protected-mac-objects.json).

## What passed, and its evidence tier

The author's final formatted repository build passed all 12 tasks; complete API
typecheck/lint passed. Windows executed **296 passes and 27 explicit skips** across
323 selected cases. The first formatting check failed, then formatting and the
final checks passed; the failed output remains.
[Author handoff](raw/mac-d237-lock-author-01/HANDOFF.md) ·
[Stage manifest](raw/mac-d237-lock-author-01/MANIFEST.json).

Independent delta QA passed its first behavioral selection: **13 independent
cases plus 15 unchanged adjacent cases = 28 passes**, with **18 unexecuted POSIX
cases skipped**, zero failures and zero retries. The initial fixture lint failure
and correction preceded that behavioral run.
[Report](raw/mac-d237-independent-qa-01/REPORT.md) ·
[Results](raw/mac-d237-independent-qa-01/RESULTS.json) ·
[Root's bounded disposition](raw/mac-d237-integration-freeze-01/root-independent-qa-disposition.json).

Windows ownership, real device/inode/file/link observations, opened descriptors,
bytes, canonical paths, hard links and genuine exited-child reclamation provide
native Windows evidence. Windows' missing `geteuid` refusal was checked before
positive controls. Positive attestation supplies only `geteuid=0` and controlled
uid/private-mode metadata; narrow unlink faults and the original observation's
completion barrier are also controlled. Those cases establish the public method
behavior under the disclosed adapters, not Darwin permissions, inode trust or
native Mac acceptance. No private proof token or lock implementation was recreated.
[Literal bindings](raw/mac-d237-independent-qa-01/BINDINGS.md).

All eight directly owned children closed with code 0 and no signal: four receipts
retain native creation-time strings, while four bind direct handles/PIDs without
a separately logged birth string. This is not a host process inventory. All
thirteen cleanup hooks passed; no owner process, store, fixed port, browser or
device session was used. QA verified **42,372 tracked file hashes and the raw
index unchanged**, with only its admitted overlay untracked.
[Owned children](raw/mac-d237-independent-qa-01/OWNED-CHILDREN.json) ·
[Parity](raw/mac-d237-independent-qa-01/PARITY.json).

The baseline snapshot's standalone command exit was unavailable; its complete
JSON was parsed and the clean source validated before installation. No missing
exit is inferred. The separate dependency setup attempt01 failed in a Python/cmd
version probe before any install; its record is a retrospective transcription,
not an original raw log. The normal PowerShell offline frozen install02 passed.
Independent QA records its own separate fresh offline installation and actual
postinstalls. Selected runtime identities do not establish a complete installation.
[Setup refusal](raw/mac-d237-dependency-install-01/setup-failure.json) ·
[Actual install02](raw/mac-d237-dependency-install-02/exit.json).

## Preserved qualifications and future verification

The whole-merge whitespace check stopped on two trailing-space lines in an
immutable, already-delivered signed-main QA driver fixture. Its bytes were
preserved. The root wrapper exit was 1; the exact child exit was not separately
saved. All **11 actual manual resolution/edit paths** passed their separate
whitespace check. This distinction waives no product, static, test or coverage
gate and does not rewrite historical raw evidence.
[Exact qualification](raw/mac-d237-integration-freeze-01/whitespace-qualification.json).

CI verifier01 was independently refused for N1 command/exporter provenance and
N2 incomplete Swift-event roster handling. Correction02 cleared the focused
mechanical findings with **42 controls**, preserving the original refusal and
fixture/documentation correction history. This accepts verifier mechanics only:
there is **no actual current CI-run admission or pass**. Historical format fixtures,
inventory/installer digest substitutions and unreplayed raw-profile inputs remain
explicit; no native GUI acceptance follows.
[Original refusal](raw/mac-d237-ci-verifier-independent-01/REFUSAL.json) ·
[Correction acceptance](raw/mac-d237-ci-verifier-independent-02/ACCEPTANCE.json) ·
[Root mechanics disposition](raw/mac-d237-ci-verifier-root-admission-01/mechanics-disposition.json).

Actual Claude opposing-family critique, complete native macOS tests and coverage
for all production/executable entries, at least 90% Swift lines/regions with
explicit branch outcomes, unchanged V8/numerical/static gates, current-head and
current-target **seven-job CI**, missing Finder/alias/Dock/browser-close/replacement/
restarted-history observations, the reserved third/final Astra MAX audit, signed
merge and owner closure all remain pending. No scan cap is renewed. These records
do not accept the full Mac product, owner QA, deployment or held/conditional work.

## Exact originals and assembly readback

Fourteen named closed packets are copied under `raw/`: **135 exact originals,
24,119,452 bytes**. Raw Markdown, scripts, failures, JSON and logs retain original
bytes. Source manifests and seals keep their original contexts; embedded absolute
locators are references, not additional copies or new evidence claims.
[Selection](raw/assembly/SOURCE-SELECTION.json) ·
[Source/destination hashes](raw/assembly/COPY-MANIFEST.json) ·
[Source binding](raw/assembly/SOURCE-BINDING.json) ·
[Assembly readback](raw/assembly/READBACK.json).

No caches or unsealed temporary candidates were selected. The finite selected-file
token-pattern check found no matches and is not an exhaustive secret audit. No
private/provider packet or unrelated evidence tree was traversed. Assembly added
only this archive and narrow raw-only rules in `.gitattributes`/`.prettierignore`,
preserved sparse configuration and did not materialize old QA. It ran no install,
build, test, provider or product process, and made no index, commit or publication
action. Root owns the remaining formatting/check/stage/commit/publish steps.
