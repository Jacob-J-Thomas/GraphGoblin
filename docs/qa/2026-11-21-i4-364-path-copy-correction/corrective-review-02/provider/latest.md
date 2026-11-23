# D206 corrective review: ACCEPT FIX

**Target:** head `67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40`, `docs/guide/07-troubleshooting.md`, line 168, the code span `%USERPROFILE%\.local\bin\claude.exe`.

The repaired literal is correct, and the one-line change introduces no defect.

## Why

- **Matches the constructor:** `harness.ts` lines 230-237 default the binary to `join(USERPROFILE ?? homedir(), '.local', 'bin', 'claude.exe')` when `options.binary` is absent. On Windows that is exactly the documented path, in the same order.
- **Renders literally:** the path sits inside a backtick code span, where backslashes are not escapes. The span contains no pipe, so the table cell boundary is unaffected. Line 167 already uses the same convention with `%USERPROFILE%\.codex\sessions`.
- **Corruption is gone:** my search of the current file found no remaining control characters (other than TAB/LF/CR) and no leftover `.localin` form.
- **Row is intact:** line 168 still has three cells. Its last cell ends with exactly 75 padding spaces before the closing pipe, which agrees with the independent 77 to 75 figure.
- **Padding count is settled:** the patch changes only this row. Its two-space padding removal is governed by the erratum and the independent report, and is not a source defect. A plausible cause, which I did not verify, is that the formatter counts the old BACKSPACE as zero width, so the visible content grew by two columns while the file grew by one byte.

## Evidence inspected

- Independent `REPORT.md` and `observations.json`.
- `decision-206-erratum.md`.
- Author `patch.diff` and `receipt.json`.
- Guide lines 166-170 and `harness.ts` lines 228-237 in the working checkout.
- Four pattern searches on the guide file only: control characters, the repaired code span, the old corrupt form, and the trailing padding on line 168.

## One evidence-wording note (not a blocker)

`observations.json` records `literal_found_once_in_backtick_span: true`. My search finds the identical code span on lines 160, 168 and 243. The field holds if it was scoped to line 168, but is inaccurate as a whole-file statement. I did not read lines 160 or 243 beyond the matched span. This does not affect the verdict.

## Limits

- **Byte-level facts are not mine:** the `08` to `5c62` replacement, file sizes, SHA-256 values, the 13 artifact hashes, unchanged blobs and modes, the clean source/index, and the head/tree/parent identity all come from the independent and root evidence. I had read-only file tools and no git or hashing.
- **Working file, not the commit:** I read the working checkout and rely on the recorded clean status for it being the committed content.
- **Unchanged clause not rechecked:** I did not confirm how `GG_CLAUDE_BINARY` reaches `options.binary`; that is outside the one literal.
- **Nothing executed:** no rendering, browser, formatter, tests, builds, providers, GitHub calls or writes.
- **Scope:** this is bounded corrective acceptance of one documentation literal. It is not a fourth general scan, renewed Astra approval, runtime QA or merge authorization, and original scan 3 remains negative.