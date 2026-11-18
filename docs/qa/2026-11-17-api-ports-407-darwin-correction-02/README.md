# Darwin correction 02 for #407

The correction starts from PR #507 head `62d443cd2aa321585b45099acb591bf3c24eafaf` and adds Darwin to the existing Windows probe list. Both platforms check IPv4 loopback, IPv4 wildcard, and the available dual-stack wildcard in the same order. Linux retains its IPv4 loopback probe. The patch updates the testing guide alongside the helper. [Source diff](candidate.diff), [prior source hashes](previous-frozen-sources.json), [corrected source hashes](darwin-frozen-sources.json)

The first hosted macOS run failed two maintained wildcard cases and the native peer assertion. Its Ubuntu lane passed 13 maintained cases and two witness cases. Those results describe the prior candidate. The Darwin correction requires a fresh macOS and Ubuntu control. [First hosted evidence](../2026-11-17-api-ports-407-hosted-posix-run-01/README.md), [retained first-failure receipts](first-hosted-observations.json)

One focused Windows run passed all 13 maintained cases. API typecheck and lint passed, and Prettier checked the two changed paths. The assigned port accepted all three bind forms before and after the test. Its dedicated temporary root was removed. [Test output](windows-focused.log.txt), [typecheck](api-typecheck.log.txt), [lint](api-lint.log.txt), [format](readable-format.log.txt), [cleanup](windows-focused-cleanup.json)

The 14-entry manifest binds the corrected code, docs and built API. All 21 original evidence files and their seal are preserved. [Source and gate verification](darwin-frozen-verification.json), [raw report](source-readme.md.txt), [original seal](evidence-sha256.json), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-api-ports-407/README.md)
