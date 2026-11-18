# First hosted POSIX control for #407

Push run 44251885185, attempt 1, tested the original candidate `62d443cd2aa321585b45099acb591bf3c24eafaf` through the seven-file QA overlay at `4579dc3b0de022da9aa90e86f7d2abfb4953214e`. The disposable QA branch must never merge. [Hosted run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185), [source bindings](expected-source-binding.json), [QA commit](github-qa-commit.json)

| Job                                                                                                                        | Maintained cases    | Native witness     |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| [macOS 26 arm64](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/job/134624282000), Node v22.23.5   | 11 passed, 2 failed | 1 passed, 1 failed |
| [Ubuntu 26.04 x64](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/job/134624282304), Node v22.23.4 | 13 passed           | 2 passed           |

On macOS the maintained cases received ports already occupied by IPv4 and dual-stack wildcard listeners. The independent peer recorded a successful direct IPv4 loopback bind while a wildcard listener remained live. The allocator granted the port and the foreign sentinel still answered. On Ubuntu the direct bind returned `EADDRINUSE`, the allocator refused the port, and the sentinel answered. [macOS log](macos.raw.log.txt), [Ubuntu log](ubuntu.raw.log.txt), [case and phase records](evidence.json)

The fixture owner passed on both hosts, with authenticated readiness, a real child restart, and release after settlement. Both jobs uploaded valid 12-member evidence archives, and their final port and temporary-root checks passed. The macOS job remains a failing control. The separate Darwin correction requires a fresh hosted result. [macOS ZIP](macos-14403264273.zip), [Ubuntu ZIP](ubuntu-14404516645.zip), [Darwin correction](../2026-11-17-api-ports-407-darwin-correction-02/README.md)

The 17 original files and their seal are preserved. [Raw report](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-api-ports-407/README.md)
