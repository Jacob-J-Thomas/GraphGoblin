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

## Independent QA and first gate outcomes

Independent Windows QA exercised 36 public CLI calls at the original candidate `58131568669c41486934ca0ac139c8e70c0d9691`. It verified first assembly, deterministic reruns, transfer of an updated MCP entry path, ownership refusals, junction and linked-tree refusals, protected-path overlap, preserved interrupted output, and one complete publication among four simultaneous writes. It retained an initial eight-process trial whose acquiring child hit its watchdog during overlapping repository gates. The four-process trial completed with a longer watchdog, one successful build and three explicit staging-lock refusals. Neither trial wrote to an owner directory.

The original candidate's local full build and formatting passed. Its local coverage sequence stopped after an unchanged adapter-Codex test exceeded its five-second timeout and its delayed cleanup interfered with the next test. The same four tests passed with identical coverage instrumentation on both the original baseline and candidate when run alone. Aggregate coverage of those partial runs remained below full suite thresholds. Linux CI ran the adapter tests and failed the new Codex assembler package branch coverage at 87.5%. The correction exercises the real CLI error-to-exit-code handler through a disposable rejected output and a successful output. The existing thresholds remain in use.

[Independent original-head QA](2026-11-14-plugin-builder-output/independent.md) retains the unchanged helper and assembly workflow evidence. Its [raw candidate results](2026-11-14-plugin-builder-output/native-results.json), [initial fanout result](2026-11-14-plugin-builder-output/native-first-fanout.json), and [validation script](2026-11-14-plugin-builder-output/native-checks.mjs) remain separate from the corrective-head test.

Independent affected QA used the built CLI from corrected source `cded46968c79359aee94a3fa5a7f5e17d2630ada`. First assembly and owned rebuild exited 0, and the rebuilt MCP entry path and file hash changed. A foreign destination and an unknown CLI option each exited 1 with a single-line diagnostic. The sentinel and previously generated config kept their exact bytes. The [raw corrective-head results](2026-11-14-plugin-builder-output/cli-results.json) record source and compiled-file SHA-256 hashes and all four subprocess results. The [test driver](2026-11-14-plugin-builder-output/cli-checks.mjs) verified the clean source head before and after the run. The first driver setup used the wrong helper hash path and stopped before any fixture or subprocess ran. The corrected driver ran each case once.
