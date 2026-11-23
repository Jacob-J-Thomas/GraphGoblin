# #407 first hosted POSIX control

[Push run 44251885185, attempt 1](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185) completed with **failure** on November 18, 2026. The macOS job reproduced an occupied-port grant with a separate live wildcard listener. Ubuntu passed the maintained suite and the independent two-worker witness.

| Hosted job | Runtime | Maintained | Two-worker witness | Elapsed |
| --- | --- | ---: | ---: | ---: |
| [macOS 26 ARM64](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/job/134624282000) | Image `20261112.0504.1`, Darwin `25.6.0`, Node `22.23.5`, libuv `1.51.0` | 11 pass, 2 fail, 0 skip | 1 pass, 1 fail, 0 skip | 119 s |
| [Ubuntu 26.04 x64](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/job/134624282304) | Image `20261111.196.1`, Linux `7.0.0-1019-azure`, Node `22.23.4`, libuv `1.51.0` | 13 pass, 0 skip | 2 pass, 0 skip | 75 s |

Both used pnpm `12.8.1`, the same frozen lock digest, and the same emitted `apps/api/dist/main.js` digest. Frozen install, build, test console capture, all postflight checks and artifact upload succeeded on both hosts. The macOS Vitest command exited 1 for each suite. Ubuntu exited 0 for each suite. [Per-case reports and job-step timings](evidence.json), [complete jobs listing](github-jobs-pages.json).

## First observed behavior

- macOS maintained tests accepted the live `0.0.0.0` listener's port `18487` and the live dual-stack `::` listener's port `18477`. The occupied `127.0.0.1` case passed.
- At port `18471`, the macOS peer directly bound to `127.0.0.1` while the owner listened on `0.0.0.0`. The real lease helper granted the port, and the owner's sentinel still answered. The independent peer failed on that unexpected grant. On Ubuntu, the direct bind returned `EADDRINUSE`, the helper refused the port and the sentinel answered.
- Both jobs showed distinct Vitest forks sharing the injected root, generation 2 acquisition, and a stale release leaving its live claim intact. The API fixture owner passed on both jobs. It authenticated readiness, killed its first child and observed closure, then restarted with the same fixture. The peer observed lease denial through unbound, ready, stopped and restarted phases, child close before the release marker, and new acquisition after settlement. The macOS peer's soft wildcard assertion preserved these later observations while keeping the test failed.
- Each job had 240 successful preflight and postflight binds across the three addresses and all 20 ports. Each of the four temporary-root checks recorded zero entries. [Mac job log](macos.raw.log), [Ubuntu job log](ubuntu.raw.log), [full phase records](evidence.json).

The candidate probes only `127.0.0.1` on Darwin. The three native observations on macOS establish why that check allows an occupied IPv4 wildcard port. The maintained IPv6 test independently establishes the grant for the dual-stack case. These are test-port allocator results from the measured hosted image. The owner Mac was outside this run.

The bounded correction under separate implementation is to select the existing three-address probe list on Darwin as well as Windows. Its effect on same-address Darwin wildcard binds remains to be verified. The next hosted check should keep both maintained and witness assertions as they were for this attempt. It can record a successful direct loopback bind on Darwin while requiring the helper to refuse the occupied port and preserve the sentinel. Linux and Windows evidence remain required for their own paths.

## Source and archive identity

This is a push control on `codex/qa/gg-407-posix-control`. Both checkout logs and runner receipts bind head `4579dc3b0de022da9aa90e86f7d2abfb4953214e`, tree `c4a991e9fe271bf3933fd0da57b93987f5ce258c`, to sole parent `62d443cd2aa321585b45099acb591bf3c24eafaf`, the original #407 candidate. The candidate's sole parent is `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The QA diff adds exactly seven sealed files. Each job validated all 13 frozen source files and seven overlay hashes. [QA commit](github-qa-commit.json), [candidate commit](github-candidate-commit.json), [connector readback](github-connector-readback.json), [prepared source binding](expected-source-binding.json).

The REST listing, uploader log and downloaded archive bytes agree on both digests. Each archive contains exactly 12 allowlisted regular members with hashes in `evidence.json`. Members have no symlinks or generated API key matches. Raw job logs match the connector's independently returned decoded text fingerprints.

| Artifact | ZIP bytes | SHA-256 |
| --- | ---: | --- |
| [macOS 14403264273](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/artifacts/14403264273) | 9,333 | `f2309819677ef7da828adfd8d670a5f2f3f2c747882aa6da1bcfe9ae993acbd4` |
| [Ubuntu 14404516645](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/artifacts/14404516645) | 7,814 | `126218ee02624d4c0af45ac0c70a1bf9156f35b6cb55c610c00e7b082ab7011a` |

[Mac ZIP](macos-14403264273.zip), [Ubuntu ZIP](ubuntu-14404516645.zip), [complete artifacts listing](github-artifact-pages.json), [offline verifier](verify-packet.py), [packet checksums](SHA256SUMS.txt).

[PR #507's normal CI](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750) is separate. Windows launcher and Template image had passed at the read-only snapshot, with Gates coverage and Browser still active. The normal dependency-audit gate remains in force.
