# Owner acceptance readiness — November 17, 2026

The integrated acceptance build is **TBD after PR #501 merges**. At this checkpoint, PR #501 remains an open draft. Main includes the terminal-wait correction from PR #487 and the three Windows launcher corrections for #435, #436 and #438. Use the actual integrated commit and installed build when recording acceptance. No installation, deployment, acceptance session or provider operation is scheduled by this draft. [Current batch register](2026-11-13-four-intents-register.md) · [PR #501](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/501)

## Delivered editor and plugin changes

The following eight items have merged engineering and await their existing owner observations. Record the installed build, platform and observations on the corresponding issue before owner closure.

| Issue                                                            | Verified merge inputs                         | Existing owner observation                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#344](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/344) | PR #462, `f4538da5`                           | Judge whether a normal plugin build and a legitimate rebuild are understandable and whether refusal on a disposable folder containing a file to preserve names the destination and explains recovery. Engineering evidence already verifies preservation.                                                                           |
| [#455](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/455) | PR #463, `cee2fd72`                           | In the intended Claude Code environment, confirm that the three namespaced skills are discoverable. Assess the clarity of a requested draft and the explanation of the selected version and result after an explicitly requested provider-free run. The verified engineering host was Windows Claude Code 2.1.311 and Node 22.23.4. |
| [#235](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/235) | PR #469, `7c6e6355`                           | Judge whether leaving an optional field absent, supplying an empty value and choosing Omit are clear in ordinary use. Judge touch spacing if relevant.                                                                                                                                                                              |
| [#209](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/209) | PR #470, `a817e5cc`                           | Judge the clarity of naming guidance, editable suggestions and recovery across create, import, template and edit.                                                                                                                                                                                                                   |
| [#273](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/273) | PR #474, `8fadcb0d`                           | Judge repair summaries, uncertainty guidance, warning navigation and how preserved editing and focus feel during normal authoring.                                                                                                                                                                                                  |
| [#237](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/237) | PR #475, `41bde22c`                           | Judge saved, published and later-edit wording, recovery copy clarity, and whether navigation and list updates feel trustworthy.                                                                                                                                                                                                     |
| [#207](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/207) | PR #478, `1cfca9bc`                           | Judge canvas drawing, selection, removal and recovery, and whether declaration editing and connected-route confirmations are discoverable. The modal keyboard connection-creation path was removed under ADR-0076.                                                                                                                  |
| [#208](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/208) | PR #480, `177f3a7d`, plus PR #482, `15ce9a1d` | On the combined build, judge stability and clarity during rapid Undo/Redo, usefulness of explicit Space cards at usual window and text sizes, and how naturally editing continues.                                                                                                                                                  |

#290 remains open for I08 intent acceptance. Engineering evidence for the eight items is already available. #452 has a separate owner-only closure obligation for the merged test-focus correction without an additional product walkthrough. [I08 checkpoint](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/290) · [#452](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/452)

## Launcher obligations

- **Windows #276.** Verify owner acceptance of opening the correct local UI and starting or reusing the expected healthy gateway from the chosen Windows build. The installed #460 incident repair already has owner-confirmed separate desktop and taskbar cold starts. #276 remains open for the overall launch/reuse experience. Record the actual build used. [#276 history](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/276#issuecomment-6872638466)
- **Windows #325.** The existing lifecycle checklist covers the intended UI, active work surviving browser-tab closure, deliberate normal or forced shutdown as specified by the accepted Windows contract, and successful relaunch. The cold-start record covers part of this sequence. Keep #325 open for the broader owner lifecycle acceptance. [#325 history](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/325#issuecomment-6872643767)
- **macOS #456.** After the engineering merge, record the remaining subjective launch and window experience on a supported Mac using the merged build. The issue assigns native Finder/Dock, identity, refusal, shutdown and persistence assertions to engineering. The approved shutdown path is the existing authenticated API. The recorded API invocation is engineering evidence, and there is no new browser shutdown control. [#456](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/456) · [Shutdown clarification](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/456#issuecomment-6935644999)
- **macOS #326.** Record any #456 owner acceptance on the focused child. The parent remains deferred with broader support parked. [#326](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/326)

PR #460 and #458 retain their separate owner merge hold. This acceptance preparation leaves the installed Windows instance and store untouched. [#458 hold](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/458#issuecomment-6870213176)

For the merged #456 build, retain the PR's concrete owner observations. Engineering evidence
does not complete this later human step:

- Cold-launch from Finder and the retained Dock pin; observe the intended local page and the
  expected instance.
- Reopen while running or launching; observe existing state without a duplicate start.
- Judge progress, Hide/reopen, Quit timing, keyboard/focus and failure guidance on the owner's setup.
- Close the launcher/browser during test-owned work and observe continuity. After deliberate
  shutdown through the existing authenticated API, relaunch and observe retained history.
- Update the managed app and exercise the retained alias and Dock pin again.

Record the actual merged build and observations on #456. No acceptance is inferred from the
earlier QA build or the new local Mac agent's engineering report, and #326's broader scope
does not close automatically with its focused child.

## Conditional follow-up after macOS delivery

#64, #125, #221 and #323 return to engineering for the authorized integrated-build revisit after #456 engineering delivery. Seek the original draft and action sequence where available. The historical bounded runs did not reproduce the reports. Use current supported editor interfaces and keep their outcome distinct from the owner observations above. [U22 baseline](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd/docs/qa/2026-11-14-i08-u22-baseline/README.md)
