# Stored snapshot version reads: #525 independent QA02

Actual independent Claude Opus5.5/xhigh QA02 returned **PASS** after one fresh headless Edge session and four image reads. It reused separate QA01 native evidence: 9 tests passed, built public version GETs passed, and immutable history stayed unchanged. The terminal runs were seeded fixtures; **no provider executed those runs**.

## Candidate and provenance

Base/HEAD: `d2df8600c2c8574bec420947de686b936910b245`. Complete five-path dirty candidate patch: `3398df229333ac5cc535fc3977afe827656650debbcca022229f9ee60a13afa6`. Index: `7ecb16615ab75e4b6a241afc1ba3055b4884528906943aa96b818759101a3b8e`.

The [QA02 report](raw/qa02/QA-REPORT.claude.md.txt), [actual actor receipt](raw/qa02/CLAUDE-EXIT.json), [binding](raw/qa02/BINDING.json) and [FUP-041 admission](raw/qa02/ROOT-ADMISSION.json) retain their original bytes. [PROVENANCE.json](PROVENANCE.json) records the recomputed report/model-result binding, actual tool use, original PNG and received image payload hashes, browser-to-fixture request IDs, history hashes, built directory hashes and browser executable hash. Curation ran no tests or browser.

Formal review1 requested stale-doc corrections. The [docs correction report](raw/doc-correction/IMPLEMENTATION-REPORT.claude.md.txt) and [receipt](raw/doc-correction/CLAUDE-EXIT.json) bind corrected docs while preserving the reviewed production/test bytes. The [review](raw/review01/REVIEW.md.txt) and [coordinator adjudication](raw/review01/COORDINATOR-ADJUDICATION.md.txt) remain historical records. The unsupported encoding asymmetry did not produce a supported public-write witness and remains a qualified read-policy limitation; no broader schema correction is claimed. The author's receipt hashes its original model-result text; PROVENANCE demonstrates the report's added terminal newline/Windows CRLF serialization separately from its preserved raw byte hash.

## Evidence established

- QA01 focused tests: 4 stored-snapshot-read plus 5 retired-event-destination tests, 9/9 overall. [Build receipt](raw/qa01/BUILD-RESULT.json).
- [Built HTTP controls](raw/qa01/native/HTTP-CONTROLS.json): omitted and materialized versions both returned 200 with equal definitions, fixed `codex` harness, absent model/effort and empty per-harness defaults. A live Settings change left the response unchanged. Wrong-loop 404, anonymous 401, foreign-owner 404 and truly invalid snapshot 500 `RESPONSE_INVALID` passed without disclosing the bad key.
- Browser request 27, omitted version `…J9K4F2`, returned200 with fixture request ID `e36c3214-91fd-4273-9169-f113266f9cbc`. Request 49, materialized version `…J9K4F3`, returned200 with ID `aa40aa08-c0ec-40e9-8bed-351d17e0d79e`. Each body matches the JSON actually read from the rendered inspector. Raw headers, bodies, request lists and rendered JSON accompany the [fixture request history](raw/qa02/browser/FINAL.json).
- Saved history before/after pairs are byte-identical. Recomputed canonical history hashes: native `85fa47ecfe67454f924975298d10a4a65bc8ef03369bfdcaf52ae11314059e6d`; browser `df0ad1eae1bb842dc3e0ce40ed9f6874f457db2531fef39d496054a29271a13a`. The omitted definition remains `cd7b884bc30f037224791201c1e95334735d060f27018dad57284dafc8cd48b1`; immutable update was refused.
- Explicit Ollama disable, zero fixture provider turns, browser close, fixture exit 0 and finalized closure are recorded. These are owned-fixture observations, not a whole-host process inventory.

## Full images and actor limits

| Page                  | Overview                                              | Pinned definition                                       |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Omitted defaults      | [Full PNG](raw/qa02/images/omitted-overview.png)      | [Full PNG](raw/qa02/images/omitted-definition.png)      |
| Materialized defaults | [Full PNG](raw/qa02/images/materialized-overview.png) | [Full PNG](raw/qa02/images/materialized-definition.png) |

All four original PNG hashes and chunk CRCs were checked. The journal confirms four successful image reads: overview payloads equal the original 1440×1507 files; definition payloads were resized to 788×2000. Full originals remain here. Exact Unicode/text equality comes from DOM/HTTP comparison, rather than legibility in the resized image.

QA02's actor read the retained native summary and four images and ran the browser wrapper once. It did not open the complete browser receipt or personally read all raw controls. Detailed network/history/cleanup claims came through the wrapper and driver; curation recomputed those bindings without upgrading actor visibility. Console validation covers the last materialized page; earlier logs are retained. No real provider run, owner acceptance or general browser/UI audit is claimed.

## Earlier failures and remaining gates

QA01 native controls were saved before cp1252 printing of U+2713 failed. The [original decoded tool-result error](raw/qa01/native-unicode.tool-result.log.txt) is retained with its journal locator. The first browser lookup failed before launch; its fixture closed. Its [failed browser result](raw/qa01/browser/BROWSER-RESULT.json), stderr and open log remain. Neither earlier failure was rewritten as a passing wrapper.

This packet concerns #525 only; it makes no QA adjudication for #523. Current-target CI, publication-head verification, reserved final review and applicable owner gates remain pending. Private provider journals/prompts, keys, READY records, profiles, databases and authenticated trace bundles are excluded. Raw bytes use `-text`; [MANIFEST.json](MANIFEST.json) lists every member except itself. Prepared externally: repository copy, staging, Windows checkout/blob roundtrip, local commit and publication require separate root action.
