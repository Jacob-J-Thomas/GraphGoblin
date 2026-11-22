# PR #557 final targeted product audit

**CHANGES_REQUIRED** at `2ac09bc116e1541eac5f93a4aaf47d6a36faa766`. Fresh independent GPT-6.2 Astra / MAX, scan **3 of 3**. One P2 blocks #386. The three schedules identified in review 2 pass on the final source. A separate owner Chat response can still retire the quiet inspector’s newly recovered credentials. #385 retains its evidence-backed **NO-CHANGE** production disposition.

## P2 · FIX-IN-PR · A retired Devices request removes a newly verified run status

The user can leave the owner Devices page with its list request pending, open a waiting run, then recover from an actual management API 401 by submitting the same key. The inspector makes the required new GET and shows **waiting** and **at real-wait**. If the older Devices GET then returns 401, the inspector accepts that old response as a new rejection. It reopens the key form, removes the verified badge and node, and displays **Updating status…** on the same run.

| Public component observation | Generation | Header and form |
| --- | --- | --- |
| Owner Devices GET starts with the synthetic owner key, without an abort signal | 1 | User follows ordinary Runs and run links |
| Separate management GET answers 401 | 2 | Key form opens |
| User submits the same key while the run stays quiet | 3 | Form closes. One new run GET returns, restoring **waiting at real-wait** |
| Only the earlier Devices 401 is released | 4 | Form reopens. **Updating status…** replaces the badge and node. Run GET count stays at two, cursor stays at 3 |

The desired-outcome assertion failed once. The fixture renders the actual app, router, both credential clients, key panel, QueryClient and inspector. FakeApi supplies management HTTP responses in process, and a local fetch stub holds the single Devices response. The earlier launch stopped at pnpm’s missing local patch preflight before Vitest. The unchanged fixture then ran with the installed runner, offline, on Node 22.23.4. This is a controlled jsdom observation. No base run or live owner/provider incident is claimed. [Witness source](owner-chat-recovery-witness.test.tsx), [execution and assertion diff](witness-run-02.log), [preflight failure](witness-run.log).

**Attribution.** The owner Devices request originates at `apps/web/src/chat/DevicesPage.tsx:393`. Its client checks only key text after the response and calls the shared rejection store at `apps/web/src/app/useOwnerChatClient.ts:14`. Both files are byte-identical to signed base. A stale response could already reopen the global key panel by this source path. At signed base, the header rendered the row directly at `RunInspectorPage.tsx:174`, and the stream subscribed to key text. This PR adds a generation change on rejection at `apps/web/src/api/api-key.ts:54`, discards header authority while rejected at `apps/web/src/runs/run-header-store.tsx:88`, and retires the old stream at `apps/web/src/runs/useRunEvents.ts:50`. Its management fetch captures the send generation at `apps/web/src/api/api-key.ts:75`. Owner Chat writes the same state without that check. Losing a just-verified waiting header and retiring its observer are material effects of this PR on the admitted recovery contract. The general delayed-401 statements at `docs/09-frontend-and-pwa.md:99` and `CHANGELOG.md:24` also exceed the implementation. [Git and literal-byte receipts](source-and-inputs.json).

**Required outcome.** An owner Chat request sent before rejection/recovery must leave the recovered generation, form and quiet inspector intact. A genuinely current 401 from a request sent **after** recovery must still reject, including when it uses the same memoized Chat client. Attribute each rejection to the credential identity and generation at request send. Preserve replacement and forgetting behavior, the existing read budget, and the management-client controls. Either a shared per-request check or an equivalent check at the owner composition boundary can satisfy these observations. A management-client-only guarantee with a separately tracked Devices limitation would require an explicit scope decision because the witnessed inspector failure would persist.

## Previous dispositions at this exact head

| Item | Disposition now | Source and behavior |
| --- | --- | --- |
| R1-1, predecessor arrives after resume | DUPLICATE-STALE | The reducer tracks a late prior terminal separately from the newest marker. Both delivery orders and a subsequent parked read are covered. |
| R1-2, successive failed attempts borrow a node | DUPLICATE-STALE | A row behind the latest terminal yields its event label and sequence. An agreeing authorized row qualifies the last recorded node. |
| R1-3, A → B → A revives cached failure | DUPLICATE-STALE | Provider-owned evidence survives navigation and the last accepted buffered batch is flushed with its originating lease. |
| R2-1, agreeing unread cached row hides the event | DUPLICATE-STALE | The selector tests the receipt before selecting row agreement. A witnessed terminal at the known tail survives the held GET. Its node appears only after a qualified read. |
| R2-2, foreign ID borrows a warm receipt | DUPLICATE-STALE | The run GET checks the returned ID before installing the body or issuing a receipt. The failed read retains A’s row and evidence. A later valid response recovers. |
| R2-3, same-key recovery misses a quiet run GET | DUPLICATE-STALE | The existing panel cancels pending queries and issues the current refresh. A late **management** GET 401 leaves the recovered generation alone. The separate Devices writer above can subsequently retire it. |
| #385, array-append projection | NO-CHANGE | The base and publication share projection blob `909c4be4bf734f7e5c8cd51126ad7051ceece08b`. Each add uses its own recorded operand. Message and nested-array appends, literal dash, escaped paths and non-add behavior have component and built-browser coverage. |

Both earlier reports retain **CHANGES_REQUIRED** at their reviewed heads. These current dispositions record verified corrections. The original ledgers and their hashes remain in [the input receipt](source-and-inputs.json).

## Verification and remaining authority

The published tree is `0c18ca86c42606016ea6b1528ccd10cd4d6e0591`, with sole parent `8632538fea2c95c3a528ef91ddbaefebf3d3bfba`. I verified all 25 feature files against Git and the stable source copies, the twelve corrective paths since `0f500bd9355d22a7497f5e4e211a85376a53151f`, and the seven-file support-only delta. The 801 publication-only paths comprise 798 QA archive members and three metadata files. The signed comparison base is `3a6943a136594162665667a7a55e2b46520912eb`, tree `a88175975c42062a08e3012a7f106396be0c685f`. The local witness used 498 exact copied source/configuration files. The receipt also records 151 workspace package and test-configuration inputs.

Root recorded **3,102/3,102** web tests in 233 files, **98.65%** line coverage and **94.44%** branch coverage. All six relevant root commands passed. Independent QA bound **36 distinct** component outcomes to 820 unchanged runtime inputs across 1,520 checked inputs. The original 35-pass/one-fixture-failure invocation and the one-case schema-corrected pass remain separate. Six built Edge cases passed with zero retries, including exact append values at 1440 and 390 px and the unchanged original Claude assertion. Browser HTTP completion and two animation frames do not establish React Query consumption. The component cases established the relevant cache observations. The new failed case is additional to both earlier totals.

The presentation registry remains bounded to 20 runs and four receipts per run. The reviewed correction does not add persistence, polling, dependencies, backend writes or permission-bearing controls. The separate credentials test surface previously covered management delayed responses and replacement-key Chat responses. It missed same-key Chat responses across routes. The earlier failed browser cleanup, D223 whole-local-check failure, and initial support lint failure retain their original outcomes.

Actual Claude Opus 5.5/xhigh authored the production changes. D224, D226 and D228 author transports ended at their budget limits without completed author handoffs. D228’s pre-edit support critique remains **CHANGES_REQUIRED**. The seven-file GPT support correction still needs its own actual-Claude targeted review. Exact-head/current-target CI, native evidence and signed merge remain independent gates. This review grants no merge, owner acceptance or deployment. The three-scan budget is exhausted. [Machine-readable dispositions](review-ledger.json).
