# Final independent inspector browser QA supplement

The final runtime revision passed both independent browser checks against a copied final web build. The earlier baseline failure, first candidate pass, and their raw evidence remain untouched. This supplement covers issue #575; it is not a general repository review. Final commit and build equivalence remain root's gate.

## Results

| Check                                  | Result                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identical external adversarial probe   | **Pass**, exit 0. Probe SHA-256 `ed2cb8bfc7fdd999acc45cc23972eab968ef7ba6cac00be6659a4fbd6be9bde0`, unchanged from baseline and first candidate.                               |
| Whole `inspector-availability.spec.ts` | **5 passed, 0 failed, 0 retries** in 6.9 seconds: original #416, new #575, and three #420 Timeline sizes.                                                                      |
| Original #416 test body                | Byte-identical to baseline first test body; only surrounding helper and additional #575 test changed.                                                                          |
| Asset integrity                        | Final copied build manifest: 28 files rechecked, 28 OK, 0 failed after execution.                                                                                              |
| Cleanup                                | Final probe restored the listener; its disposable API/control ports had no listeners after teardown. Browser and request contexts were disposed; gateway received stop signal. |

The probe used a genuine second `GET /runs/{id}` response fetched before the listener loss and held at the browser route. It stopped the actual listener at 07:10:29.499 UTC and witnessed the stream's incomplete-chunk failure; the global outage notice appeared at :29.556. The older 200 response was delivered at :29.556. A new run GET began at :29.561 and failed with connection refused. At :29.671 the last-observed label was visible, the typed answer was retained, all checked write controls were disabled, and an implicit form submission had sent no write. After the listener restored at :29.672, a later successful browser run GET arrived at :30.571. Exactly one deliberate input POST followed at :30.652, and the run succeeded at :30.695. The probe's trace and request ledger are private; the sanitized machine receipt omits raw URLs, headers, bodies, and run IDs.

## Tested binding

- Base commit for the worktree: `eadb202946d4e76db5d8e2ff4af1733197e96ea2`. These are working-tree source hashes at final webbuild02; root will compare final commit blobs and built asset equivalence.
- Final `inspector-read-provenance.ts`: SHA-256 `a7905377d30436f328a18ab8039cd8118248edd9bc4e594151188dd395ede728`.
- Final `useRunEvents.ts`: SHA-256 `f4b2780c4187484218e3ad238d8dabb7166c8483d3c0e98147557c75054e9545`.
- Final `inspector-availability.spec.ts`: SHA-256 `83e10daa5bbec12ec0059180ce500c890dfe4d1bdab9811009fe3ad02d3180e9`.
- Final 28-file dist manifest: SHA-256 `9cf98767c155c8273e30306fea05e59c6cb096cf36607032c78b0e3a56fd4092`. `index.html`: `97ca23f1cc8206705af6f04720cc07fc9ae72f0dfc3434f0d913ae3a38c2485a`. App JS: `28cdf2fb5cd9bb11923dd154038122365dfd119ad445b4eeb668c62dff1bc80b`.
- Runtime: native Node 22.22.2; Corepack pnpm 12.8.1; Playwright 1.63.0; bundled Chromium revision 1243 / Google Chrome for Testing 153.0.8010.12; macOS arm64.

## Exact commands

The external probe ran from the projectless workspace root:

```sh
GG_QA_REPO=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/inspector-repair \
GG_QA_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/final-candidate-dist \
GG_QA_OUT=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/final-candidate-run \
/opt/homebrew/bin/node /Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/read-crosses-listener-loss.mjs
```

The full permanent spec ran from `work/inspector-repair/apps/web`:

```sh
GG_E2E_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/final-candidate-dist \
GG_E2E_MAIN_PORT=0 GG_E2E_CONTROL_PORT=0 \
/opt/homebrew/bin/corepack pnpm exec playwright test -c playwright.config.ts \
e2e/inspector-availability.spec.ts \
--output=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/final-inspector-results --reporter=list
```

Private evidence: `final-candidate-run/{result.json,trace.zip,gateway.log}` and `final-inspector-results/.last-run.json`. Sanitized evidence: `final/qa-receipt.sanitized.json` and `final/full-spec.log`. The initial sandbox loopback denial remains a separate setup-only receipt; it is not counted as a product failure.
