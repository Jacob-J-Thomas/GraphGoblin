# Independent D197 corrective QA plan

This is the separate, bounded documentation QA assignment, not author verification, a general formal review or a replacement final audit. The original scan 3 CHANGES_REQUIRED remains unchanged.

1. Inspect the existing independent checkout and preserve it if dirty. If clean, fetch only exact candidate 08633913a58cb42c32b4a18c72cd4aed67cfefa6 from the local author checkout and detach at it. Bind head, tree, parent, changed paths and source hashes.
2. Independently trace all six changed recovery paragraphs to the public run route, engine selection/snapshot/recovery/Replay, UI published-version selection and publication/trigger contract. Include negative cases and the external-prerequisite-repair exception.
3. Inspect the supported package test entries and Vitest configurations. Run the existing engine definition-pin suite (15 cases) and API definition-pins suite (4 cases), once each. Use Node 22.23.4 first on PATH, pnpm.cmd, and per-process TEMP/TMP G:/ggq/qa-scratch/i4-362-draft-docs-qa-01. Build only if the actual entry requires it; bind any build artifacts.
4. Check the three-doc formatting and diff whitespace. Retain all failures; no retry of an unchanged failing command and no weaker assertion.
5. Seal a report with raw command logs, exact source references and hashes, case-level results and limits. Check the checkout and original sealed report are unchanged. Preserve authentication and republish errata separately.

No provider/account/native HTTP/browser, network/GitHub, new or edited product tests/source, global settings, commit, push or subagent work is authorized. The checkout operation and local exact-object fetch are expressly authorized. Independent tests establish public-method/in-process behavior only. Fable review, exact-head/current-target CI/native verification and coordinator completion are separate root-owned gates.
