# Captures not kept

Large raw measurements are retained only locally. The phase manifests record their sizes and SHA-256 hashes. Do not include these captures or disposable stores in the commit.

- [before captures](before-NOT-KEPT.md)
- [after captures](after-NOT-KEPT.md)
- [after-final captures](after-final-NOT-KEPT.md)
- [after-cursor captures](after-cursor-NOT-KEPT.md)
- [after-verified captures](after-verified-NOT-KEPT.md)

The initial baseline assertion diff also exceeded 1,000,000 bytes. Its exact size and SHA-256 are in the before manifest; a concise original regression excerpt is retained in baseline-regressions.log.txt.

All proposed log copies below are UTF-8 with local user paths replaced by `%USERPROFILE%`; raw local logs remain outside the proposed commit. Native stderr produces PowerShell `NativeCommandError` annotations even when the underlying command succeeds; command exit results are recorded in the report.
