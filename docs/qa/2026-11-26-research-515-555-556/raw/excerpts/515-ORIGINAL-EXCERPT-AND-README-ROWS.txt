# Exact-row excerpt for research revision 03. Rows are 1-based physical lines of the named
# source; text is exact apart from the removed line terminator. Format: <row><TAB><text>.

# Source: G:/ggq/delivery-evidence/2026-11-24-followups/ui-479-515-555/original-evidence/515-original-failure-excerpts.txt
# SHA-256: e45c214216c33930b2308199f9c4b5c1dea1e6afc1cb031610ed1f38f026d57d (matches the previously recorded value)
# Bytes: 14961
1	--- baseline-build.log ---
65	--- candidate-coverage.log ---
73	@graphgoblin/infrastructure:test:coverage: ⎯⎯⎯⎯⎯⎯ Failed Tests 52 ⎯⎯⎯⎯⎯⎯⎯
125	@graphgoblin/infrastructure:test:coverage:  FAIL  src/sqlite/chat.test.ts > durable chat identities > returns an acknowledged admission after closing/reopening the store and does not repeat seeds or pair claims
126	@graphgoblin/infrastructure:test:coverage:  FAIL  src/sqlite/history-cleanup.test.ts > large retained stores > does not let 61 budget-protected artifact jobs hide removable workspaces in a later window
127	@graphgoblin/infrastructure:test:coverage: Error: Test timed out in 20000ms.
128	@graphgoblin/infrastructure:test:coverage:  Test Files  4 failed | 70 passed (74)
129	@graphgoblin/infrastructure:test:coverage:       Tests  52 failed | 1106 passed (1158)
130	@graphgoblin/infrastructure:test:coverage:    Duration  121.85s (tests 63%, import 30%, transform 6%, worker 1%)
131	 Tasks:    1 successful, 4 total
132	Cached:    0 cached, 4 total
133	  Time:    2m4.941s 
134	
135	--- candidate-coverage-continuation.log ---
164	--- candidate-web-coverage.log ---
165	     × keeps held section JSON exactly when a rename makes the applied section equal to it 21542ms
166	⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
167	 FAIL  src/editor/EditorPage.rename-activation.test.tsx > a pointer press that commits a self-reference rename (#273 A2) > adds exactly one operation on the repaired source, as one step after the rename
168	AssertionError: expected [ { method: 'PUT', …(5) }, …(1) ] to have a length of 1 but got 2
169	 FAIL  src/editor/EditorPage.rename.test.tsx > renaming a node in the editor (#273) > keeps held section JSON exactly when a rename makes the applied section equal to it
170	Error: Test timed out in 20000ms.
171	 Test Files  2 failed | 222 passed (224)
172	      Tests  2 failed | 2909 passed (2911)
173	   Duration  2078.55s (tests 56%, environment 23%, import 9%, setup 7%, transform 4%)

# Source: G:/ggq/delivery-evidence/2026-11-24-followups/ui-479-515-555/original-evidence/515-original-local-comparison.md
# SHA-256: 8d74d6c7ee98d0bef83a40ae523d740cff8a2e3b9482a2cbf155752a76b43fae (matches the previously recorded value)
# Bytes: 8867
3	PR #512 covers Intent 2 units U2.3 (#473) and U2.4 (#472). This record binds the author checks, independent behavior QA and first hosted CI to source `14a84a180495b65e0788994b25974d05a2b94ca7`, tree `4602f86fa5f1153cca60f33ba6411fcc4780f775`, and base `d3f651c83779ded401878094d35374ac2f494d3d`. The independent QA receipt matches all 12 changed source blobs. [Delivery register](../../delivery/2026-11-17-five-intents-register.md) · [Independent predicates and source binding](independent/predicates-and-lifecycle.json)
13	- The #473 author's first native harness call used a JSON content type on a bodyless publish request and received `MALFORMED_BODY`. After correcting the probe header, the harness reached MCP. The author also corrected two `require-await` lint findings and formatted a test import. The targeted, build, typecheck, lint and selected coverage results are in the retained author record. [Original check excerpts](mcp-author/original-check-excerpts.txt)
16	- The first broad local Windows coverage runs remain failures. Infrastructure passed 1,106 of 1,158 tests with Windows filesystem and existing timeout findings. MCP passed 71, skipped two, and failed the existing persisted thread-history case at its 5-second deadline. Independent QA also observed that MCP failure under the full local run. Web passed 2,909 of 2,911. Held section JSON hit the 20-second test deadline. The pointer activation case expected one draft PUT and observed two. The PUT payloads and cause were not established by that log. No local coverage threshold or test deadline was changed. [Author check excerpts](mcp-author/original-check-excerpts.txt) · [Independent first MCP log excerpt](independent/unit/mcp-first-run.txt)
20	The base-first comparison passed both focused cases on base. On source the infrastructure history-cleanup case hit its 20-second deadline and MCP persisted thread history hit its 5-second deadline. Reversing the order gave four passes on the same two commits at the original deadlines. CPU samples in the inverse run ranged from 19% to 64%. The observations establish that the two timeouts did not reproduce in the inverse run. Order, host load and their interaction remain unproven causes. A separate focused comparison exercised the two #273 editor tests once on each revision, with their original deadlines and ordinary test setup. Both passed on both revisions. The full candidate run had recorded a 20-second held-JSON timeout and two autosave PUTs when the pointer test expected one. The focused run did not enable coverage instrumentation or reproduce the broad-suite workload. The cause of the original observations remains undetermined. [Editor comparison](windows-timing/editor-rename-comparison.json) [Paired timing receipt](windows-timing/comparison.json)
