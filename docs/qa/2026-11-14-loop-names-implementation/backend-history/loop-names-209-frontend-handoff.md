# #209 API handoff to Claude UI implementation

Integrate the GPT backend commit in one atomic PR with the Claude UI slice. The current repository behavior accepted same-name copies through the template action. The backend's refusal deliberately changes that behavior and therefore requires an explicit UI retry affordance and coordinated coverage before integration. Root owns publication, head/target selection and adjudication of any gate blocker.

## Public contract

- POST /loops, PUT /loops/{id}/draft, POST /loops/import and POST /templates/{id}/draft use the same owner-scoped equality. Whitespace trims and collapses using ECMAScript whitespace; matching uses default Unicode lowercase. The authored display spelling is otherwise preserved.
- Equivalent names belonging to another current loop return RFC 9457 status 409, code LOOP_NAME_CONFLICT, a user-readable detail and advisory string suggestedName. Normal stale editor-token DRAFT_CONFLICT takes precedence on a stale save, and still carries draftToken. Use a distinct appearance/interaction for name conflicts so the collision is not treated as stale-document overwrite.
- Use GraphGoblinApiError.problem.suggestedName after checking the exact code and the string type. A suggestion may be taken before a retry, so the endpoint can return another 409 with refreshed advice. A failed attempt preserves the current draft or original loop.
- For import, call loops.import(client, originalDocument, {name: selectedName}) when the user chooses to retry. This sends name in the query and leaves the uploaded document unchanged. For template copies use the existing explicit name field in the create-draft request body. For create/rename use the existing loop-name field.
- NUL or lone UTF-16 surrogates return status 400 LOOP_NAME_INVALID; U+FFFD and valid emoji are accepted. Existing device pairing labels are separate from generated graph names.
- No automatic retry or automatic creation of an ordinary copy occurred. The UI implementer owns controls, interaction, copy and layout. The docs for current shipped behavior are in numbered docs 03 and 07 plus ADR-0073. Update docs 09 with the implemented UI and leave existing owner closure open using Part of #209.

## Browser checks to retain and extend

1. Create and rename an ordinary loop with variations in case and whitespace. Confirm both rejected writes leave displayed server entities and IDs intact. In the editor a rejected name retains the authored draft on the device and permits retry after editing the name.
2. Import an unchanged export while the original exists. Check the visible collision and suggested name, deliberate retry with the original document plus selected name, exact distinct IDs and matching graph.
3. Repeat an installed template's Use action. A first conflicting attempt must leave the catalog and original graph unchanged; explicitly accept or enter a unique name, then create a distinct draft.
4. Existing e2e/template-gallery.spec.ts includes several same-starter cases against the shared E2E system and a deliberate repeated-copy test around line 189. Update fixture setup or application interactions to match the new contract and retain exact graph/package/identity and retry assertions. The repeated-copy test compares graphs separately from distinct display names.
5. Existing e2e/edge-routes.spec.ts around line 518 and forms.spec.ts around line 293 import a valid document whose source is still present. Use a distinct explicit import query name and retain original geometry/template assertions. Preserve forms.spec.ts invalid import refusal around line 337. Inspect other fixtures using identical names within a single real test gateway; fixtures should name independent loops deliberately.
6. Independent touched-systems QA includes the existing public API file-store matrix, real Edge interactions, and the new cross-vendor review/whole-PR audit sequence.

## Status

The backend implementation starts from b3b5e1874a8252cc01c065d18fef42cbfbe075b4 in C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin, branch codex/gg-20261114-loop-names. The frozen backend commit is fddadabf8d838098da003cf7fa072050f179445d. It passed 133/133 touched API tests, 4/4 real SQLite tests, 9/9 API-client tests, and focused typecheck/lint, and 2/2 built API upgrade tests. The API reference and generated client schema were refreshed. Full repository checks and the browser criteria run on the combined head. Baseline duplicates and verification logs are under docs/qa/2026-11-14-loop-names.
