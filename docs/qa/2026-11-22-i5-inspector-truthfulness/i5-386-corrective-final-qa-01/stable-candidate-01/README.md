# Frozen 0f500 affected QA: partial results, unaccepted

**Disposition: UNACCEPTED.** Root stopped this candidate after independent Review 2 reported additional defects outside the executed schedules. The sealed reviewer report is still awaited by this QA task; those new criteria have not yet been authored or executed here. No further test or QA/product source change will occur until a new candidate is supplied. These results remain useful only for their exact source and schedules. There is no final acceptance seal.

## Source and completed checks

Source HEAD `0f500bd9355d22a7497f5e4e211a85376a53151f`, tree `a9154362e2938cb7645acc79f8ab3dc109953a3d`; candidate receipt SHA-256 `2b57ba0841024d7e1c9c22f5d7b8bffb315abe95b49228092709d1d8edf985bd`. All 22 source members match the literal candidate copies and Git blobs before and after execution. The five D226 production files remain byte-identical. The supplied browser fixture changed only comment lines 127/128; its executable bytes remain unchanged. Original Claude spec remains `e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0`.

- **31/31 independent component cases passed**, once, retries zero: all 24 corrective public cases and seven earlier independent cases. `components.json`, `components.log.txt`, `component-summary.json`.
- **Full web types and scoped four-file QA lint passed**, including the new public QueryObserver fixture. `types-lint.log.txt` and its exit-zero receipt.
- **Build passed 9/9 tasks**: eight unchanged dependency cache hits and current web cache miss, compiling both web and Goblin bundles. `build.log.txt`, `build-artifacts.json`; served web index SHA-256 `9bd4fb6c32e8ab816105df339557eeb54a0ca6882fcd69ae40e40378a9ec3756`.
- **Five of six distinct browser cases passed**, as qualified below. The failed invocation and trace remain retained, and the corrected fixture is unexecuted.

The component C2 case uses the approved public disabled QueryObserver lifetime, captures a defined old call signal and verifies it remains non-aborted at release, observes old failed #3 install into the real QueryClient after 21 public run visits, keeps the header neutral, and converges on fresh success. The old cache-install/noClaim/fresh-convergence assertions were unchanged. The original D226 30/31 failure remains sealed separately; this is a new admitted fixture schedule on this candidate, not a retroactive pass of D226.

## Browser evidence

Existing built UI, real loopback HTTP API, disposable in-memory test database, fake clock and fake harness; installed Microsoft Edge through Playwright, one worker and retries zero. Owned ports 18786/18787 were verified free before startup and are unbound after work closed. No actual provider, account/key/private configuration, owner store or protected port was used.

| Case | Result | Evidence |
| --- | --- | --- |
| Supplied Timeline outcome with run and observation held | PASS | `held-projection-browser.json`, held trace |
| Supplied equal-sequence stale running row, observation held | PASS | Same invocation, stale trace |
| Independent both-model-held then stale response schedule | **FAILED during route cleanup** | Behavioral assertions, two screenshots and schedule completed; `route.fulfill: Route is already handled!` during finally. Raw failure/trace retained. |
| #385 exact recorded appends and non-add diffs, 1440 px | PASS | `output/playwright/independent/P-1440-*`, passing trace |
| #385 exact recorded appends and non-add diffs, 390 px | PASS | `output/playwright/independent/P-390-*`, passing trace |
| Original Claude family-specific selection through publish/run and succeeded assertion | PASS | Unchanged source, `original-claude-browser-selected.json`, passing trace |

The original Claude command first selected zero tests because its anchored grep excluded the full title prefix. That command's no-tests output remains retained; the corrected unique unanchored title selector ran the actual case once, which passed. The protected source was not edited.

The initial five-case browser invocation remains **4 passed / 1 failed**, not a retroactive pass. The independent case completed its stale-header assertions, screenshots, schedule JSON and rendered HTML before cleanup. It then released two held observation handlers and immediately called unrouteAll(wait). Trace fetches start at 10992.126/10992.724 ms; fulfill at 11002.554 succeeds, fulfill at 11009.380 fails already handled, and interception patterns become empty at 11016.703. These timings do not establish query-response cancellation or React Query cache consumption. See `failed-independent-route-trace-events.json` and `failed-independent-cleanup-timeline.json`.

Root approved the bounded QA-only correction under `independent-browser-closure-01/`: both route callbacks count active handlers with decrement in finally; cleanup releases the gates, polls activeRoutes zero using the existing expectation budget, then calls unchanged unrouteAll(wait). Product assertions, timeouts and request operations remain unchanged; no errors are ignored. Original QA copy SHA `26c4364fbc94c33311c723a36c340c222b426e4dc4c352bcb28eaacee57df682`, corrected SHA `58cd117d2d723c41486b4ae7d8b2d9dc5895703b83875263ed0e7675731bc112`. Exact diff and old/new bytes are retained. Scoped lint passed. The artifact destination moves to the closure directory so old screenshots/schedules stay unchanged. **The corrected case has not run**; root stopped the candidate before its reserved browser slot.

## Evidence limits and preservation

Component evidence establishes real QueryClient installation where explicitly asserted. Browser held/stale evidence establishes actual HTTP response completion and parsed stale body values followed by rendered-header checks; it does not identify which overlapping query/follower response entered the query cache or prove every returned response was consumed. #385 browser checks compare actual recorded patch values, expansion and exact full-thread download at both viewport widths, with horizontal extent asserted within the viewport. This is finite affected QA, not full-application regression, real-provider, native-persistence, owner acceptance or merge approval.

QA checkout HEAD remains `3a6943a136594162665667a7a55e2b46520912eb`; index remains `a04bf3d924fe09cee1896f685cfae49ae74066746b08bb57e6b3e930191c2a48`. Common HEAD remains `a60843a9050b3a203726db84f6abf1f45b8bc694`, common index absent. All supplied product bytes remain unchanged; only the explicitly approved QA fixtures differ from prior receipts. No installation, Git write, publication, formal feature scan, review ledger reset or merge approval occurred. Final source/status receipt: `partial-results-and-frozen-source.json`.
