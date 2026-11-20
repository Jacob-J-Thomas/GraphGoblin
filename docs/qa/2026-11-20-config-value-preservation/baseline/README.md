# Structured JSON Value: held baseline

**CHANGES REQUIRED.** The third and final general audit of [#513](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/513) found one blocking P1 in the actual structured override row's JSON **Value** input. A literal `__proto__: false` member disappears before validation, and the narrowed draft is autosaved with **All changes saved**. This baseline preserves that observation and the complete authentic report. It contains no correction, author-completion or candidate-pass claim.

[Reconstructible original report](report.reconstructible.txt) · [Exact browser observations and inputs](editor-value-observations.json) · [Byte selection and original hashes](publication-manifest.json)

| Source binding            | Recorded identity                                                |
| ------------------------- | ---------------------------------------------------------------- |
| Held PR head              | `053015f93f7d106435bed7ffa052e1938e3d1d85`                       |
| Target main               | `b9ad7a03898d8dd4b46552a5750de79ce81a91f1`                       |
| Head and hosted test tree | `1c8e6276cacbabcf83ce54600f3cfc605fc2e89f`                       |
| General audit             | Independent GPT-6.2 Astra MAX, scan 3 of 3; **CHANGES REQUIRED** |

## What the baseline actually shows

In the built editor's inference node, **Settings → Advanced → Config overrides**, the existing `example` row and an unchanged `neighbor` row were exercised. An ordinary object saves exactly. A nested `"bad key": false` control retains the typed text, displays a blocking schema error and leaves the preceding server draft unchanged. Correcting that control restores exact autosave.

The direct object `{"marker":"reserved-changed","__proto__":false,"survivor":true}` instead reaches PUT and fresh GET without `__proto__`. The array case `{"marker":"array-changed","rows":[{"__proto__":false,"enabled":true}]}` loses that member inside the array element. Both show saved state without a blocking message; reopening after reload retains the narrowed array value. The neighboring row remains intact and the loop remains unpublished. A direct API submission of the unmodified reserved-member input returns **400 MALFORMED_BODY** and leaves the prior complete draft unchanged.

The first trial sampled an intermediate corrected control before autosave settled. It remains in the original observations with that limitation. The separate confirmation waits on actual server readback and saved UI for each valid marker and records all four autosave bodies. No earlier failure or timing qualification is replaced.

This was real ephemeral HTTP over the built API test composition, production web assets and a fresh headless Chromium session, with fake providers, timers disabled and a disposable in-memory database. The fixture required no API key. It was not a native owner-store or provider run. The browser and synthetic server closed; a fresh connection to the test port was refused. The report's earlier contract, recovery, integration and CI conclusions retain their own execution/source boundaries; their previous packets are linked rather than copied here.

## Exact original reconstruction and checks

The authentic report's SHA-256 is `60f56748ec41ffa92716ec3749280db37e77cbc92fe3fde4c670e9d81b700f6a` (20,249 bytes). Its two final LF bytes cause the standard Git EOF-whitespace check to reject a newly added copy. The archived text here omits **only the final LF byte**; appending byte `0A` reconstructs the exact authentic report. The original source remains untouched. This explicit derivation changes no report content or verdict. The original report's relative link to `editor-value-observations.json` still resolves beside it.

The companion JSON is byte-identical, SHA-256 `239798fc6c3d615a52a99baf547c6cd531526d14d1c674bcdd24b065c97fceb6`. Its narrow CRLF attribute retains the original bytes while preserving blank-at-EOL, blank-at-EOF and space-before-tab checks. No whitespace check or formatter exclusion is disabled.

Run `node verify-baseline.mjs` from this folder, or invoke that script by its full path, to verify the inventory, original-report reconstruction, local links and retained baseline facts without starting the application. To recover the exact original into a new file outside the sealed folder, run `node verify-baseline.mjs --reconstruct-report PATH_TO_NEW_FILE`; existing files are refused.

## Later correction evidence

Only this held baseline is ready now. Add source-bound author results and independently executed candidate evidence after authentic reports and terminal receipts arrive. The focused acceptance must cover both failing Value shapes and a valid control: retain the complete invalid text and identify the offending member before copying can erase it; prevent a successful narrowed autosave; preserve the exact last valid server definition, valid siblings and neighboring rows; then clear refusal, save the corrected definition exactly and retain it after reload. Preserve structured-Key, whole-section JSON and direct API refusal controls. A corrected result must not be inferred from earlier recovery QA, passing CI or this retained-record replay.
