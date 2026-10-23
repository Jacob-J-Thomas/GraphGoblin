# Round 5 qualification of the runtime matrix

The D-029 audit's first matrix run on `112d6207e7f59c707e2f06e29f71551fa08551aa`
was **88 passed, one failed**, not a clean 89/89 gate. The case was
`CLI claude resume-named init`; its assertion received `definitely-not-submitted`
where it expected `delivery-uncertain`.

The stored failure was `INFERENCE_TIMEOUT: Claude CLI did not answer before the check deadline.`
Node B had no `harness.session` or positive acceptance event. The native fake CLI's no-turn
readiness check timed out before the intended init-only turn launched. The classification was
correct for that earlier boundary. One isolated replay passed; that does not erase the first
failure or establish a clean whole-matrix pass. The earlier README/matrix's 89-pass presentation
does not qualify that first audit execution.

[matrix-initial-failure.json](matrix-initial-failure.json) retains the auditor's stored failure
and B events, copied without changing their values from
`%TEMP%/gg-audit-f4-20261022/matrix-failure-inspection.json`. The auditor's original initial run
and its isolated replay, observations of `112d6207` and not of this head, are committed as
[audit-matrix-initial-112d6207.txt](audit-matrix-initial-112d6207.txt) and
[audit-matrix-isolated-112d6207.txt](audit-matrix-isolated-112d6207.txt), copied from the audit
directory's `matrix.txt` and `matrix-isolated.txt` in the second audit round. The auditor's
originals use CRLF line endings and hash to SHA-256
`8c95b0119914da0075dc8fcece16a09db21cdad8c3dc20528a43c2c01c928a51` and
`d0f87010e7dd56ee41f2ab1b7fecc8968e778f3751b86bd7fa841212c91840e1`; git stores text with LF
line endings, so the committed blobs hash differently, and the contents are identical after
newline normalisation (every line equal).
The existing QA `matrix.txt`, `matrix-checks.md` and earlier gate logs are unchanged.

The qualified [driver](api-driver.txt) makes three changes relevant to reproducing this case:

- Every Claude init-only case must have a B `harness.session` event from validated CLI init,
  carrying the expected session ID, before checking its failure classification. Claude emits
  this event from the protocol init accumulator; selecting an inherited ID cannot satisfy it.
  A pre-launch readiness failure now says `Fixture did not reach Claude init`.
- Only the fake CLI fixture gets `preflightTimeoutMs: 60000`, allowing process startup under
  load without changing production readiness defaults. The existing 60-second matrix state
  observation deadline still fails a case that does not settle in time.
- New runs write `matrix-qualified.txt` by default, require an explicitly supplied revision
  for accurate provenance, and use port 5662 with `gg-wp-f4-r5-api-*` stores. This prevents
  overwriting the historical matrix and aligns the driver with the round-5 isolation range.

Run only the qualified case, plus the driver's required key/auth smoke, from the worktree:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:QA_REVISION = (git rev-parse HEAD)
$env:QA_ONLY = '^CLI claude resume-named init$'
$env:QA_EVIDENCE = 'matrix-qualified.txt'
$matrixDriver = Join-Path $env:TEMP 'gg-wp-f4-r5-matrix.mjs'
Copy-Item docs/qa/2026-10-22-wp-f4-qa/api-driver.txt $matrixDriver
node $matrixDriver
```

The driver starts only fake-provider turns. Its cleanup removes files from its validated own
store and retains the empty directory. It does not delete directories. Round-5 results and any
fixture/setup failures are recorded separately in the Round 5 report; no full 89-case rerun or
historical pass-count rewrite is claimed.
