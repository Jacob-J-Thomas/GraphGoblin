# #209 independent backend QA

[Issue #209](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/209), source head `5df84b2d434fa367a241891a57df13f6401cf17b`, containing the frozen GPT backend commits `fddadabf` and `f9e17528`. The previous-build migration control used exact `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`. Backend paths and selected source hashes matched before and after. The runner used Node v22.23.4 and the workspace tsx loader with development export conditions. Existing distribution files were fingerprinted and excluded from runtime. Claude's concurrent UI work remained outside this verification.

One bounded first execution passed 66 public Fastify calls against native disposable file SQLite. No Fastify socket listened and no inference provider was called. The only direct repository actions were provisioning disposable owner credentials for API authentication. The duplicate upgrade fixture was created and repaired through the previous-build public API.

| Criterion                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner and name identity    | Two authorized owners independently created the equivalent Unicode name. A same-owner variant with ECMAScript whitespace and case folding was refused. Same spelling values did not grant cross-owner lookup. The original authored spelling round-tripped. Canonically composed and decomposed distinct values both succeeded, consistent with no Unicode normalization.                                                                                                           |
| Draft save and stale token | A case/space equivalent edit of the same loop kept its loop and draft IDs. The obsolete token returned `DRAFT_CONFLICT` and the current token even for a taken name. With the fresh token the same competing name instead returned `LOOP_NAME_CONFLICT` and a suggestion. Both refusals preserved the full detail. Explicitly accepting the suggestion stored the requested companion edit under the original draft ID.                                                             |
| Import and template        | Reimporting an actual export left the list unchanged. A separate request consumed the first suggestion and the stale retry returned another conflict with a different suggestion. An explicit next retry imported the unchanged document using the query override. Repeated template creation likewise refused and preserved the first draft. Explicit requests created distinct loop IDs with equal graphs after excluding names.                                                  |
| Concurrent requests        | One concurrent four-route collision between create, save, import and template returned 201/409/409/409. The rejected rename preserved its draft, and a fresh owner list contained one equivalent record. Two simultaneous creates returned 201/409. These are application-level requests sharing a native store. The separate implementation evidence covers native independent write connections.                                                                                  |
| Invalid names              | NUL plus lone high and low UTF-16 surrogates were refused with 400 `LOOP_NAME_INVALID` through all four writers. Existing loop detail and list count were unchanged. U+FFFD and valid supplementary pairs read back intact.                                                                                                                                                                                                                                                         |
| Existing duplicate upgrade | The previous build admitted and published two equivalent names. One produced a terminal pinned run. The new build's in-process startup refused with both IDs, prior-build rename guidance and a reset preview command. Database file hashes before and after refusal were equal. An explicit previous-build draft rename restored candidate startup and preserved both loop IDs, exact published versions and the pinned run identity/name. No automatic rewrite or reset occurred. |

The first attempt passed without fixture corrections. Cleanup observed no remaining Node or esbuild fixture process, gateway lock or SQLite sidecar. The two disposable data files remain in the external evidence directory.

## Reproduce

Copy the runner to an external disposable directory. Use the two dependency-installed source checkouts and project Node v22.23.4.

```powershell
$source = '<candidate checkout>'
$prior = '<previous checkout>'
$runner = '<external>/verify-names-209.mjs'
$loader = ([uri](Get-Item -LiteralPath "$source/apps/api/node_modules/tsx/dist/loader.mjs").FullName).AbsoluteUri
node --conditions=development --import $loader $runner $source $prior
```

[Runner](verify-names-209.mjs) · [Observed API and startup results](observed.json) · [Cleanup](cleanup.json)

This establishes affected backend behavior on the stated source. Integrated UI and browser QA, review, CI, audit and owner closure remain separate.
