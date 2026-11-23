**ACCEPT FIX** for the known D242 B2 script and deletion correction only. I found no remaining in-scope blocker.

## Identity and method

- **Before:** `f64287619b499c14601e11bce3d1c6b5414b6227`
- **Corrected:** `20a69d9b53910a5ede81088e9ff67680f348ce68`, tree `8be5890a170f2a51af49467e1f71e88839bef28b`
- **Target:** `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`
- **Patch SHA-256:** `457402b79e479db7d232c19980540f691a8a822c04c78c3206a38a2812c5458a`

I used Read only, on all 27 roster paths: 25 in full, plus `docs/09-frontend-and-pwa.md` lines 150–244 and `CHANGELOG.md` lines 1–60. I ran nothing and recomputed no hash or byte pin. The eight changed files I read contain the patch's post-image wherever I compared them. Every execution result below is root's inlined evidence, not mine.

## Why the fix holds

The cause was that both action owners lived inside the conditional run section (`RunInspectorPage.tsx:485-486`). They are now page-level hooks keyed to the visit (`RunInspectorPage.tsx:302`, `375-376`); the reviews stay in the section and end with it. The patch touches no withholding, qualification or gate code and none of the three provenance-core files.

| Criterion | Source reading | External execution |
| --- | --- | --- |
| Pending identity, second confirmation refused | `ScriptRecovery.tsx:80-81,88,93,131-133`; `HistoryEligibility.tsx:72-73,79,83,167,178,200,208,248` | Native cases 1–2: one POST each, where f642 had two |
| Late transport failure | `ScriptRecovery.tsx:85,146-150`; `HistoryEligibility.tsx:94-96,137-139,222-224` | Native 3–4: both messages visible within 2 s, absent on f642 |
| Ordinary success | `ScriptRecovery.tsx:71-77,86`; `HistoryEligibility.tsx:98-100,127-135` | Native 5–6 |
| Run and visit isolation | Owner comparison at `ScriptRecovery.tsx:80`, `HistoryEligibility.tsx:72`; the Runs list has its own instance | Native 7–8; `RunInspectorPage.offline.test.tsx:1339-1406` |
| Native dismissal: preview allowed, confirmation guarded | `HistoryEligibility.tsx:104-107,229-235` with `dialog.tsx:155-163`; an outage or unmount close is the component's own (`dialog.tsx:137-141`) and does not release the hold | Native 9–10; `HistoryEligibility.test.tsx:532-577` |
| Runs list unchanged | `HistoryEligibility.tsx:310-320`; `RunsPage.tsx:160-165` | All 233 prior focused cases still pass |
| New valid action after settlement | `ScriptRecovery.tsx:133-140`; `HistoryEligibility.tsx:178-183` | Native 3–4 second POST; focused cases |

The write guards are unchanged:
- **Script:** `assertOpen` and the frozen sequence with explicit consent at `ScriptRecovery.tsx:62-63`.
- **Deletion:** the gate check at `HistoryEligibility.tsx:83` and the frozen IDs, action and token at `88-93`.

A matching GET changes none of this state, so it cannot authorize a second command. The patch adds 3 + 2 + 6 = 11 cases, which matches the reported 233 to 244.

Root's annotation at `HistoryEligibility.tsx:67` is type-only and root-authored. The first focused wrapper's TS2379 at line 318 remains a real first failure.

## Notes that do not block

1. **Doc wording.** `docs/09-frontend-and-pwa.md:219-220` says a transport failure is "never" reported as a refusal. That depends on `isOfflineError` in unlisted `lib/utils`, and `HistoryEligibility.tsx:139` still prints "Not saved" for anything it rejects. Parked #561 may bound the claim, so root should confirm or qualify the sentence.
2. **Visit stability.** Ownership rests on `useMemo` at `RunInspectorPage.tsx:302`. If React ever discarded that value, the guard would open rather than close. Session recovery makes the same assumption.
3. **Later visit.** Going A, B, then A again is a new visit: it can send a second command, and the earlier outcome is dropped (`HistoryEligibility.tsx:75,85`). This is root's stated boundary, and native 7–8 show it as intended.
4. **Evidence gaps** (source reasoning only):
   - Dismissal combined with withholding ran only under jsdom; native 9–10 omit the remount schedule.
   - No test settles an outcome while the section is still withheld.
   - The handler refusals at `ScriptRecovery.tsx:133` and `HistoryEligibility.tsx:178` cannot be shown to run in the component tests, because the launchers are disabled.
5. **Coverage.** Two defensive branches (`ScriptRecovery.tsx:93`, `HistoryEligibility.tsx:105`) are unreachable from the current callers, and whole-web coverage is still running.
6. **Earlier re-enable.** A successful confirmation stops counting as pending at POST return (`HistoryEligibility.tsx:98-100`), so inspector launchers re-enable before the refresh. A new review still reads its own preview.
7. **Outside the roster.** I did not read `lib/utils`, `inspector/RunControls.js`, `app/App.js`, `app/bootstrap.js` or the API client core. Error text, `assertOpen` and the page staying mounted through a key change rest on the native and focused results. Other controls in the section were not assessed.
8. **Covered outcome.** With a newer review open after a dismissal, the first outcome sits under the modal backdrop; the old code reported it in the same place.

## What this verdict is not

- The Astra CHANGES REQUIRED at f642 stands; formal passes remain 3/3 and general scans 2/3.
- The strict G1 failure (#563) is preserved, not green.
- Intercepted writes show browser dispatch and feedback only, not backend effects.
- This is not an Astra sign-off, merge decision or owner acceptance.
- Whole-web coverage, current CI and native artifacts, and signed delivery remain outstanding.