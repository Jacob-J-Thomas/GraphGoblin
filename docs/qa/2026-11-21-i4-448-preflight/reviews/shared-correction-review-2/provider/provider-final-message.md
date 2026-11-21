# Targeted correction review 2: A is accepted, B is accepted

I reviewed both correction deltas statically and read-only, using Read, Glob and Grep only. Neither delta adds a misleading claim, and neither has a direct root cause that should block it. The earlier verdicts still stand for the commits they covered: review 1 gave `f96a4073` CHANGES_REQUIRED and gave `b45807f0` APPROVE. These two verdicts cover only the correction deltas.

| Slice | Verdict | Head | Tree (from the brief) | Base (sole parent, from the brief) |
|---|---|---|---|---|
| A: #427/#365 | **ACCEPT CORRECTION** | `8980c27c75e04d33cdcf48736c71db05e35175a3` | `7e23133e3d1f6ffdf49d7d025fc7a15aaf290c54` | `f96a4073c3b53af7724d1ef5593eeaf03194c4cd` |
| B: #448 | **ACCEPT CORRECTION** | `083d7264ffaeaadba44ebd2f929efb4ac526a127` | `485df640b90c94ac9a79bc8fe682b311748dd876` | `b45807f033601a53919f2c9e16e0de751971a518` |

**Checking that the patches match the worktrees:** each branch ref matches its head (`refs/heads/codex/gg-i4-427-guide` holds `8980c27c…` and `codex/gg-i4-448-preflight` holds `083d7264…`). The patches came from `capture-patches.py` (`git diff base head`, which asserts the worktree is clean). The files in each worktree match the added lines in the patches.

## A — #427/#365: ACCEPT CORRECTION

**F1 (decision provider text) is fixed.**
- **CHANGELOG (lines 8–9)** now limits the kept explanation to "Recognized Codex inference-turn refusals" and says "LLM decisions retain only a safe failure category."
- **guide/07 (lines 119 and 135)** limits the diagnosis and the fix to Codex inference turns. The new paragraph at lines 141–146 says the decision records only a safe category, that this category can't establish an account cause, and that the fix is a deliberate supported model followed by a new run. guide/06 (lines 47–50) and docs/06 (lines 509 and 518–521) are limited the same way.
- **The source agrees:**
  - The Codex refusal code becomes `DECIDER_HTTP_ERROR` with no status, and the provider text is dropped (`decider.ts:14-35`).
  - The engine replaces the message with "Decision provider request failed" (`decider-errors.ts:6,24-50`).
  - Without a status the failure can't be resumed, and `details.code` is set (`primitive-evaluator.ts:83-102`).
  - That function is the path LLM decisions take (`primitive-evaluator.ts:288-332`).
  - LLM decisions can only use Codex (`contracts/evaluation.ts:367`, `z.literal('codex')`).
- The rule against keeping provider text is unchanged, and no fallback or coerce policy was added.

**F2 is fixed.**
- **Plan information:** guide/07 (lines 128–129) and guide/06 (lines 44–45) now name the bundled CLI's static plan information and say GraphGoblin's catalogue has no account-plan field. That matches `contracts/catalog.ts:13-22`.
- **Restart step:** added at guide/07 lines 135–136 and docs/06 line 514.
- **`model_not_found`:** removed. Line 123 now says "A generic failure…".
- **Duplicate row:** the existing "Codex rejects the model ID" row (line 166) now links to the new section, and the anchor resolves.

**F3 is fixed in the three named places.**
- docs/06 line 523, `options.ts:90-92` and `isolation.ts:24-25` now say only that each thread setting wins over an override of the same key, and that this doesn't establish what other sandbox keys enforce.
- **The SDK agrees** (`codex-sdk@0.160.0 dist/index.js:178-235`): config overrides are emitted first, followed by `--model`, `--sandbox`, `--cd`, effort, `network_access`, `web_search` and `approval_policy`.
- **The adapter always sends** model, effort, sandbox, approval, network, web search and skip-git (`options.ts:46-60`), plus the working directory when one is set.
- **Comment-only:** both `.ts` changes sit inside `/** */` blocks. The proof that the compiled JS is identical is the root's evidence, not mine.

**Optional wording notes (not blockers):**
1. guide/07 line 141 says "A refused Codex route request" without a qualifier. A 403 or quota refusal actually becomes a resumable `DECIDER_NOT_AUTHENTICATED` or `DECIDER_RATE_LIMITED` (`events.ts:337-353`; `primitive-evaluator.ts:83-89`). The word "instead" and docs/06's "the same refusal" do tie it to the HTTP 400 case. "The same HTTP 400 refusal…" would be more precise.
2. docs/06 line 521 says "this change does not expand…", which reads like a changelog entry and will date in a design doc.
3. Two older statements fall outside the delta. I'm reporting them only; no action is requested in this slice:
   - ADR-0063 line 32 still says "which no override can weaken". The ADR describes itself as a historical record, and review 1 treated ADR wording that way.
   - guide/07 line 114 says "Correct the node, decision or default" for an inference-only failure code.

## B — #448: ACCEPT CORRECTION

The patch changes only the doc 11 table: 9 lines, of which only the Default model row changes in content and the other eight change padding only. I checked that row against `apps/api/src/preflight.ts`:

| Table cell | Source |
|---|---|
| **ok:** the Codex model is in its enabled catalog, with no effort claim | The model is in the catalog (codex rows) and enabled; effort isn't checked (lines 270 and 283–288). |
| **ok:** the Claude default is the exact supported model and effort | The model is in the catalog, effort is explicit and supported, and the model is enabled (lines 412–425). |
| **warn:** the Codex default is in the catalog but disabled | Lines 280–281. A disabled Claude default is no longer listed as a warning; it fails (lines 417–418). This fixes follow-up 2 from review 1. |
| **fail:** the Codex model is missing | Not found in the codex rows (lines 272–278). That includes an unset Codex model when the setup isn't Ollama-only (lines 367–368; `config.ts:126-130`). |
| **fail:** the Claude default is missing, unknown, wrong-family, disabled, or has an unsupported effort | Lines 413–419. |

"Has unsupported effort" now applies only to Claude. That removes the old row's implication that preflight checks the Codex effort, and the delta adds no new promise about Codex effort. Other doc and guide pages don't contradict the new row. The other parked follow-ups were not pulled into scope.

**Optional wording note (not a blocker):** "Claude default is missing" could be read as "no Claude default is configured". In that case the check doesn't run at all (line 411), and the table's Harness row treats that setup as valid. The fail actually comes from a configured Claude entry whose model isn't in the catalog (line 414). A missing Claude effort also fails (line 415), but the table only implies this through the ok cell. The old row had the same ambiguity, and the parallel wording makes the intended meaning clear. Possible rewording: "a configured Claude default has a missing, unknown, wrong-family or disabled model, or a missing or unsupported effort."

## Limits
- I ran nothing: no git commands, tests, lint, typecheck, format or build. I did not verify parentage or tree SHAs myself; I rely on the brief and the root's capture script. I did not recompute the SHA-256 hashes of the earlier reviews or read the public GitHub comments.
- For A, I checked the runtime claims against the source only. The live QA results (a recognized 400 keeps its reason, a decision gets the generic non-resumable failure, an unknown shape stays uncertain and resumable) are still pending QA.
- I verified the SDK's argument order for flag precedence. How the Codex CLI resolves dedicated flags against `-c` keys internally has not been measured, the same limit as review 1.
- This doesn't claim QA, CI, the final AstraMAX check or owner acceptance. Closing #448 is still the owner's call, and I closed and published nothing.