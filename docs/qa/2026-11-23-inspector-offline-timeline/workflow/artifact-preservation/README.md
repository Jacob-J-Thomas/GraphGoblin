# Planned archive preservation rules

These are E-only insertion snippets for root after the active author closes and archive integration begins. They do not modify the product or any test/coverage setting.

Append PRETTIERIGNORE.fragment to the repository-root `.prettierignore` and GITATTRIBUTES.fragment to the repository-root `.gitattributes`, after checking the final rules in context. Both apply to the entire new QA subtree. The attribute rule disables text normalization and whitespace interpretation so selected raw and sealed Markdown bytes survive unchanged. It does not disable tests, coverage, lint or review.

The default plan has **no formatter exception**. Preserve every core/S2 inner sealed reading note and all selected raw JSON, TypeScript, Python, PowerShell, JavaScript, patch, diff, trace, screenshot and other evidence bytes. Do not add a broad Markdown exception or format inner readers.

If root chooses to format the final current top-level README during integration, append PRETTIERIGNORE.README-OPTIONAL.fragment after the subtree rule. This exception applies only to `docs/qa/2026-11-23-inspector-offline-timeline/README.md`; it never applies to an inner core/S2 README or historical planning reader. Format that final README before its final byte pin/seal and refresh its copy-plan hash, inventory and readback afterwards. The whole-subtree `-text -whitespace` attribute remains in force, so the finalized README bytes are still copied exactly. Do not represent a draft hash as the final formatted hash.

Finalize and format other new prose outside the ignored QA subtree before pinning/copying it. Once a sealed source is selected, copy its exact bytes and re-read the copied bytes, filtered Git blob and committed bytes through the existing root gates. Future edits require refreshed evidence accounting; these snippets grant no publication or seal complete delivery.
