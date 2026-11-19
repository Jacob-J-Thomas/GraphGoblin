# #429 corrected source: independent behaviour QA summary

**Source:** `2a335040a64b4ddf9ab66019b7e55fda9454707e`, tree `24c8e058…`, parent `071f261e…`, prior published `33708ef3…`.

- All 16 bound file hashes match the worktree and the commit blobs, and the tree is clean.
- Built with Node 22.23.4 and pnpm 12.8.1: 9 forced tasks, 0 cached.
- Everything ran on Windows 11 against isolated synthetic stores, non-owner ports, an inert fake Codex CLI and a fresh Edge profile.
- No real provider, owner data or credential was used. No repository or Git writes were made.

| Check | Result |
| --- | --- |
| Refusal tiers S01/S02 | unchanged, byte-identical to the original QA run |
| Registered HTTP matrix (40 non-reserved cases) | 39 identical to the original candidate; I08's pointer is now `gg_qa~1slash`; all 18 valid configurations still publish with identical readback |
| Slash/tilde pointers in create, draft save and validate (15 cases) | 15/15. Each pointer decodes (RFC 6901) to the exact literal member of the sent body, including the nested-table, array and nested-array cases, literal `~1` text, and the flat-vs-nested pair, now distinct. Unrelated and unknown-field comparators are unchanged |
| Native recovery replay | 41/41. The key-only repair still gives GET/Publish 500 as documented; the full documented correction gives 200/200 on the same version and survives a restart; product libsql's "1 affected row" leaves the quoted member in place |
| Recovery edges | 27/27. Snapshot rows: 0 changes from the documented statements, and the trigger refuses an unfiltered UPDATE. Discovery stays non-empty for a member added beside the bad one or renamed to another refused name; a correct rename gives discovery 0, GET 200, Publish 200 on the same row, and a restart |
| Real Edge, structured form (v2) | 28/28. A refused Key is marked invalid and described with the rule, while its Value stays clean. A real value error stays on the Value. The issue link focuses the Key; for a nested key it focuses the Value, and the outer Key is not blamed. The error survives Advanced and JSON-mode transitions, remount and reload. JSON mode refuses a pasted bad key. The correction saves and publishes, and the neighbours (timeout 120, read-only) are unchanged throughout |
| Held Key `__proto__` (typed or pasted as a Key) | The entry is never deleted and never published. A paste keeps the previous key; typing commits only the allowed prefixes (`__proto_`). The value stays editable and saves under the kept key. Focus stays in the Key. The message names the kept key. Remount, reload or undo shows the committed key |
| First browser run | 20/26, retained. Its failures were driver predicates or ordering, with no product difference |

**Observations** (non-blocking; full detail in the private README):

- **Held text and the save state.** While `__proto__` is held, the toolbar says "All changes saved" and nothing appears outside the row. Closing the dialog, reloading or Undo discards the held text silently.
- **Undo after a refused paste.** App Undo reverts the previous committed edit, not the paste; Redo restores it.
- **Live status for a typed key.** For a refused key typed character by character, the polite status names the first refused prefix (`gg_qa/`) rather than the final text. The input's own description is current.
- **Nested refused key in a JSON value.** It has no inline message or invalid mark on the Value; only the issue badge and the Advanced count show it.
- **JSON mode on open.** Opening JSON mode on a form that already holds a refused key shows no rule and leaves Apply enabled.
- **Pre-existing.** Only the first invalid key is reported, and import and editor issue paths remain dotted.

**Accessibility:** observed through the browser's accessibility tree (invalid state, description, focus and status text). No screen reader was used.

**Disposition:** the corrected behaviour passes. **Remaining gates:**

- fresh CI on `2a335040`;
- the opposite-family formal reviews;
- the final independent audit.

Whole-repo gates and coverage, non-Windows hosts and screen-reader testing were not run here.

Machine-readable observations are in `observations.json`; screenshots of the Config overrides group are in `screenshots/`.
