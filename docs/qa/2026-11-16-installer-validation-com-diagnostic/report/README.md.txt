# #436 first hosted Shell Link diagnostic

On the hosted Windows image, WSH `Save()` returned successfully for the requested filename `Chrome α.lnk` and created `Chrome a.lnk` in its place. The requested path was absent when the property-store factory opened it. This reproduces and localizes the failure observed during the first baseline's fixture setup. The probe ran no installer cases. [First baseline](../436-hosted-baseline-first/README.md) · [Hosted Windows job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43801684182/job/133083194588)

## Case receipts

| Case | State immediately after WSH Save | Property-store observation |
| --- | --- | --- |
| Unicode `Chrome α.lnk`, U+03B1 | Save returned true. The only directory entry was `Chrome a.lnk` with Latin U+0061, 2,254 bytes. Exact filename absent and native file identity could not open it. The same directory state remained after the factory calls. | Read/write and read-only opens at the requested path each returned `0x80070002`. Neither write nor read got a property store. |
| ASCII `Chrome A.lnk` | Save returned true. Exact path existed with native file identity, SHA-256 and decoded target, arguments, working directory and icon. | Write open, SetValue, variant clear, Commit, read-only reopen, GetValue and read variant clear each returned 0. Reopened variant 31 returned exactly `GraphGoblin.QA436.Source`. |

The Latin surrogate was byte-identical to the 2,254-byte pre-Commit ASCII control, SHA-256 `774334d4b30ade0bae2e13cd3e192553c43ce26b6444fa3169609913cc2d87a7`. Both carried the expected shortcut argv, working directory and icon. The committed ASCII link was 2,351 bytes, SHA-256 `7708ee5be73e888473e9c95399b8b566a120655812c9c84ef2d4c751503f6357`; its property-store data block contained the exact UTF-16 AppUserModelID. The ASCII path and decoded fields stayed the same across Commit, while its file ID changed on the same volume. Both pre-Commit and final bytes are retained. [Microsoft Shell Link format](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/747629b3-b5be-452a-8101-b9a2ec49978c)

The first offline comparison stopped because the two Unicode snapshots retain different call-site lines in their otherwise equivalent file inspection errors. The second check verified each retained stack frame and compared the other fields. The original archived JSON and binary were unchanged.

## Hosted identity

- Attempt 1 of Actions run 43801684182, Windows job 133083194588, used diagnostic branch head `26b245315f353c07d1b5f55f2885a156779be5e3`. Actual checkout `0d1435f45b57b95fa7397111c4e07eae067a7ac2` had the admitted head and actual post-#435 base `be633141be5a0cd2b4f960a46761fabbf2cb82c7` as its second and first parents, respectively. The tree was `7cbb7177aa24d681cf40f6a6372c63e9d3518678`. The wrapper's three input hashes independently matched both frozen diagnostic files and the original Windows helper. The receipt records successful closing verification.
- OS Windows Server 2025, build 26100, image `win25-vs2026` version `20261103.298.1`, PowerShell 7.6.9, session 2. The image version, recorded SID and Chrome proxy digest agree with the first baseline evidence. The probe was a separate disposable hosted attempt.
- The diagnostic child PID 6272 was born at 04:07:32.1706622 UTC, exited 0 at 04:07:36.0363005 and separately closed empty stdout and stderr at 04:07:36.0667792. Both case dispositions were recorded. The original Windows suite also passed its 17 tests. The two diagnostic step display names were shortened by YAML comment syntax. Their bodies executed and their archive uploaded successfully.
- Artifact 14196488008 is 12,003 bytes with 31 files and SHA-256 `379eacb368041dbce1cb11b22aabd09aa4a65e46c06010524f5279a5829a98ef`. It matches the GitHub digest and independent root download. The exact decoded Windows log is 65,239 UTF-8 bytes, including its leading BOM and final CRLF, SHA-256 `3ae80f6f98ac45f01558205238df94056c0c9ea229d19c6901c7ad2e3338d3d8`.

The next baseline driver preparation preserves the Unicode inputs and replaces WSH fixture creation and readback with explicit Unicode Shell Link COM operations. It requires an exact-path identity check immediately after Save. The causal finding here is the filename produced by the tested WSH call. Explicit Unicode COM Save, Load and the 32 installer cases still require fresh admitted hosted evidence.
