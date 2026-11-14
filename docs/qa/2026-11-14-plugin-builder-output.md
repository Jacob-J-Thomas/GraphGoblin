# Codex plugin builder output ownership

Issue [#344](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/344) protects the public `--out` path. Checks below are implementation evidence. Independent delivery QA records its own results.

## Baseline reproduction

On Windows with Node `v22.23.4`, the built Codex assembler at main `b3b5e1874a8252cc01c065d18fef42cbfbe075b4` received an existing, disposable directory named `foreign output 漢é`. It exited `0`, built a marketplace, and removed `owner-sentinel.txt`.

## Candidate observations

The same Node executable ran the candidate’s built CLI against a disposable copy of the plugin package in a path containing spaces and `漢`. Its workspace dependency symlink resolved to the candidate checkout. The caller used a separate disposable working directory and a dummy MCP entry.

| Case                                                      | Result                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Existing unowned directory                                | Exit 1. Original sentinel bytes preserved.                               |
| Working directory, package directory and plugin source    | Exit 1 for each. Package sentinel bytes preserved.                       |
| Junction destination and missing child beneath a junction | Exit 1 for each. Target directory contents preserved.                    |
| First build and rebuild into owned output                 | Exit 0 for both. The rebuilt registration used the newer MCP entry path. |
| Existing inventory plus an unrelated file                 | Exit 1. Foreign file bytes preserved.                                    |

The focused Codex package suite exercises source manifests, the three skills, marketplace assembly and repeat builds. The shared helper suite adds filesystem roots, modified and malformed inventories, Windows path names, concurrent builders, and injected rename conflicts. Rename failures are controlled tests. The actual CLI cases use native Windows process and filesystem operations.
