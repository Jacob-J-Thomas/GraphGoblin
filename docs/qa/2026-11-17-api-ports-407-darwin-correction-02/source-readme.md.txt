# #407 Darwin correction 02

This test-infrastructure correction starts from PR #507 head `62d443cd2aa321585b45099acb591bf3c24eafaf`. It extends the existing ordered three-host bind probe to Darwin. Windows and macOS probe `127.0.0.1`, `0.0.0.0`, and `::`; Linux probes `127.0.0.1`. The same socket error handling, optional IPv6 fallback, claim protocol, and tests apply. The testing guide records the platform scope. [Candidate diff](candidate.diff)

## First hosted result

On macOS 26 arm64 with Node v22.23.5, the original candidate passed 11 of 13 maintained cases. The cases for a foreign IPv4 wildcard and a dual-stack wildcard each received a grant. The independent native peer also recorded `nativeBind=bind-succeeded`, `reservation=granted`, and `foreignAnswered=true`. The Linux lane passed all 13 maintained cases and both native witness tests. The independent hosted evidence directory retains the original logs and archives. This packet records their SHA-256 values and relevant line references. [Original macOS job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185/job/134624282000), [retained log references](first-hosted-observations.json)

## Local verification

One focused run on Windows with project Node v22.23.4 passed all 13 maintained cases. API typecheck and lint passed, as did Prettier for the allocator and testing guide. A test-owned TEMP was empty after the run, and all three bind forms succeeded on the assigned port both before and afterward. [Focused run](windows-focused.log), [command](windows-focused.json), [typecheck](api-typecheck.json), [lint](api-lint.json), [format](readable-format.json), [cleanup](windows-focused-cleanup.json)

The frozen manifest records all 14 source and built-entry hashes. Only `apps/api/src/testing/api-port.ts` and `docs/10-testing-and-quality.md` differ from the prior manifest. The API entry still hashes to `3160AC2A1339525DC3F63400BBD9ACA29AEA6663442D625CE6728BD35619325C`. The four earlier evidence packets and their index match the published base. [Prior source manifest](previous-frozen-sources.json), [Darwin manifest](darwin-frozen-sources.json), [verification receipt](darwin-frozen-verification.json)

The first hosted results refer to the previous candidate. The corrected macOS and Linux native control and full hosted CI require fresh exact-head results.

