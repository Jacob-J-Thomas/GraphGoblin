# Independent browser QA after stream-loss revision

**Web-only result:** The identical external browser probe passed on copied webbuild03 assets, and all five tests in `inspector-availability.spec.ts` passed with no retries. Earlier baseline and candidate evidence remains unchanged. The root-owned reviewer diagnostic establishes the graceful SSE EOF followed by a quick second drop; this external browser probe checks a hard listener refusal with a real older run response crossing the outage boundary. API #581 integration and final commit identity are separate gates.

## Browser observations

The probe fetched the second real browser run GET while the API was healthy and held its body. At 07:36:39.275 UTC, the actual listener stopped. The browser stream failed with incomplete chunked encoding at :39.276; the global outage banner appeared at :39.331. The older 200 run response was released at :39.332. A new run GET began at :39.337 and was refused. At :39.448, the last-observed label was visible, input JSON remained intact, all checked run write controls were disabled, and an implicit form submission sent no write. The listener restored at :39.449; a later successful run GET arrived at :40.343. Exactly one deliberate input POST followed at :40.450, and the run succeeded at :40.503. No other browser write occurred.

The permanent browser file ran all five scenarios on the same copied build: #416 waiting-run outage, #575 pre-loss read boundary, and #420 Timeline at 1440px, 320px, and 320px with 200% text. **5 passed, 0 failed, 0 retries, 6.9 seconds.**

The disposable API/control listeners used ephemeral `127.0.0.1` ports and had no listeners after the probe. The browser and request contexts were disposed, the stopped listener was restored, and the gateway received its stop signal. All 28 copied asset hashes still matched after both runs.

## Tested binding

| Item                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| Identical external probe           | `ed2cb8bfc7fdd999acc45cc23972eab968ef7ba6cac00be6659a4fbd6be9bde0` |
| 28-file copied webbuild03 manifest | `9dfd54784c692c69334b218bcf20e6818df1910a602a282b3b913446d662eacf` |
| Copied `index.html`                | `b9e7cafa075aa748e94a79252e988fedb4fcb41ec8321777c152602355f3db1c` |
| Copied app JS                      | `18697b179aead5667ed3ab61451a3a944c92ff8061a4386296d53cc12f643b59` |
| `useRunEvents.ts`                  | `a8e6ab1e36a872cc357a11f715427160385837be2f3dfb5f92f4b5ecf09f8977` |
| `inspector-read-provenance.ts`     | `a7905377d30436f328a18ab8039cd8118248edd9bc4e594151188dd395ede728` |
| `inspector-availability.spec.ts`   | `83e10daa5bbec12ec0059180ce500c890dfe4d1bdab9811009fe3ad02d3180e9` |

Base worktree commit: `eadb202946d4e76db5d8e2ff4af1733197e96ea2` plus tested working-tree web edits. Runtime: native Node 22.22.2, Corepack pnpm 12.8.1, Playwright 1.63.0, bundled Chrome for Testing 153.0.8010.12 on macOS arm64. Root will bind final commit blobs and build identity; this report records the tested pre-integration web state.

## Exact commands and evidence

External probe, from the projectless workspace root:

```sh
GG_QA_REPO=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/inspector-repair \
GG_QA_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/graceful-final-dist \
GG_QA_OUT=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/graceful-final-run \
/opt/homebrew/bin/node /Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/read-crosses-listener-loss.mjs
```

Whole permanent spec, from `work/inspector-repair/apps/web`:

```sh
GG_E2E_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/graceful-final-dist \
GG_E2E_MAIN_PORT=0 GG_E2E_CONTROL_PORT=0 \
/opt/homebrew/bin/corepack pnpm exec playwright test -c playwright.config.ts \
e2e/inspector-availability.spec.ts \
--output=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/graceful-final-inspector-results --reporter=list
```

Sanitized machine receipt: `graceful-final/qa-receipt.sanitized.json`; whole-spec log: `graceful-final/full-spec.log`. Private raw result, trace, and gateway logs remain in `graceful-final-run/`. The receipt omits response bodies, raw request URLs, headers, and run IDs.
