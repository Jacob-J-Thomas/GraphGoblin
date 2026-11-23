# D206 — Restore the literal Windows Claude path in #364's guide

During the integration comparison, root found an introduced ASCII BACKSPACE (byte8) in the default executable path in docs/guide/07-troubleshooting.md line168. The displayed/copied code span therefore did not match ClaudeHarness's actual default. This is a documentation defect, not a runtime or permission defect.

Using the owner's delegated blocker authority, repair the control byte to the literal backslash and b. Scoped Prettier adjusts edge padding on that same table row. All other lines and cell contents stay exact, and the path now reads `%USERPROFILE%\.local\bin\claude.exe`, matching the existing constructor components. Freeze67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40/treebb0bd9a31e1d873c88778ff11b78b9ad46fd5c8e has parentc9d23dd1a996cde40d285c1ce103b8c8291cb3ab. The only changed file is the guide; D203 runtime/source and all old evidence remain unchanged.

Require separate independent byte/path QA and actual Fable5.2/xhigh bounded corrective review before integration. This is a single known in-scope correction under D-035/D-042, not a fourth general review or renewed Astra sign-off. No maintained unit test or full application rerun is warranted for this literal documentation repair. The final integrated head still needs ordinary CI, numerical coverage, native artifact verification and coordinator completion.

Root author evidence is G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-364-path-copy-author-01. It retains before/after bytes and the finite verification repairs: the first comparison did not account for Prettier's one-space table-padding adjustment; a slow diagnostic byte matcher was stopped in its own session before the final bounded line/cell comparison. Those checks happened before staging/commit and did not alter product assertions.

Alternatives declined:
- Leave the invisible character because runtime QA passes: rejected because readers could copy an unusable executable path.
- Rewrite the surrounding startup guidance or runtime resolution: rejected because this finding concerns one corrupted literal and broader behavior already has its own reviewed scope.
- Rerun the complete runtime matrix or reopen general scan4: rejected as unnecessary for an unchanged runtime and contrary to the existing finite scan policy.
- Edit old archived source or reports to hide the bad literal: rejected; original evidence remains immutable and the correction receives a separate record.

The original final scan remains negative at its own revision. Independent checks and final current-target gates are still pending; this decision is not owner acceptance or deployment.

