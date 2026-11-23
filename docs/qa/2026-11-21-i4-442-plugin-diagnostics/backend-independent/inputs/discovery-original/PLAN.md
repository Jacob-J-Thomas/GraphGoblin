# #442 bounded diagnostic proposal — awaiting coordinator selection

No product source has been edited. Discovery now includes a successful two-control diagnosis and
the CLI-only plugin matrix described in REPORT.md; product delivery gates remain pending.

## Recommended minimal surface

Add one informational warning check to the existing system preflight report when Codex CLI/login
preflight succeeds. Suggested identity: `plugins.codex`, label `Codex plugins`, status `warn`.
Use the existing PreflightCheck shape and expose it through both `--preflight` and
`GET /system/preflight`. Warnings keep report.ok true and do not prevent startup/execution.

Also show the same honest limit in Settings' existing Codex preflight item, alongside its
unchanged readiness badge, authentication problems and Retry behavior. The parent selected
actual Claude ownership for that copy/component/test work after the concrete contract is accepted.
The UI keeps its existing `/harness/preflight` query; no extra probe or new fetch is needed.

Suggested operator text:

> Loaded plugin tools are not verified by preflight. Inspect `codex plugin list --json` and
> `codex mcp list --json` in the worker directory; neither proves every enabled plugin loaded.
> Verify the expected tool in the worker before relying on it.

The claim is about **GraphGoblin's check**, not a universal claim that every supported Codex
interface is incapable of diagnostics. We found app-server inventory interfaces, but the bounded
app-server lane could not be admitted to a read-only, contained probe: it started curated Git
fetches even with remote_plugin=false. Its incomplete bad-asset/unknown-ID coverage must remain
explicit. Pinned 0.160.0's measured CLI list omissions justify the warning without pretending that
configuration, a list, or a successful unrelated turn proves expected tools loaded.

This warning is deliberately informational for a healthy plugin and an intentional disable too:
it says the check does not measure worker tool health, not that the plugin is broken. A generic
preflight has no inference node's effective working directory/overrides and must not infer them.
Codex CLI/login readiness remains its existing separate result. No runtime policy, plugin feature,
auth, model, stored data, configuration or provider turn changes.

Expected implementation files after selection:

- packages/domain/src/readiness.ts: export fixed `CODEX_PLUGIN_OBSERVABILITY_NOTICE` through its
  existing public export, so backend and UI present one consistent claim. This is pure text in
  the existing readiness boundary, without a new schema, package or dependency.
- apps/api/src/preflight.ts: add the scoped informational check in the existing successful Codex
  branch; no new subprocess or inventory call.
- apps/api/src/preflight.test.ts and a focused public CLI/HTTP diagnostic regression if needed:
  prove the warning exists, CLI/login readiness stays ready, warning-only reports exit 0,
  failed/missing/unauthenticated Codex retains its existing failures, non-Codex setups get no
  Codex-success warning, and no additional CLI/config/provider work occurs.
- Actual Claude-owned apps/web/src/settings/sections/PreflightSection.tsx and its focused tests:
  show the shared notice only for the Codex item, preserve ready/failed badges and errors, keep
  Retry/query behavior, and ensure Claude/Ollama cards do not acquire the Codex notice. A
  SettingsPage integration assertion should establish the user can see the notice with Ready.
- docs/11-security-and-distribution.md: explain the new check and its information-only status.
- Coordinated docs/06, research/codex-sdk and troubleshooting/CHANGELOG amendments: state the
  pinned CLI omissions and the limits of supported inventory. The coordinator owns integration
  with #427/#365 and #448 documentation/preflight overlap.

No new route/schema field, package, dependency, filesystem validator, model call or generated
contract is proposed. The existing /harness/preflight route continues to report CLI/login
readiness; documentation must distinguish that narrower result from the system diagnostic.

## Alternatives and tradeoffs

1. Add a typed warnings/plugin-observability field to HarnessPreflight and present it throughout
   Settings and both diagnostic APIs. This is coherent if the owner wants a broader UI surface,
   but changes contracts/API clients/rendering and expands this bounded warning. Actual Claude
   UI ownership/review would be appropriate. Do not hide informational data in `problems` when
   the harness is ready: system preflight's success branch does not render that array, while
   Settings renders any problems as problem text. Using it for this fixed scope notice conflates
   an actual readiness problem with an unmeasured capability.
2. Join app-server config/read with plugin/list/read and mcpServerStatus/list. It can expose some
   inventory differences, and explicit plugin/read of an unknown name might report not-found,
   but a missing MCP file can still look like a legitimate plugin with zero MCP servers. More
   importantly, actual startup caused curated downloads and cache writes. Do not integrate this
   into read-only preflight without a separately designed and verified lifecycle/network bound.
3. Parse cache directories/manifests and inspect assets. Decline: private layout coupling, a new
   package-health manager and untrusted filesystem semantics are explicitly out of scope.
4. Start plugin services or invoke tools automatically to assert health. Decline: arbitrary
   services/tools can have effects; mere discovery or a process tree is not a health proof.
5. Disable plugins or substitute a fallback. Decline: changes accepted inheritance, disabled and
   node override policy, and fails #439's owner intent.
6. Documentation-only disposition. It preserves the known limit, but existing numbered docs
   already disclose #442. It provides no new diagnostic result to an operator reading preflight.
   Select only if the coordinator explicitly accepts that narrower disposition.

## Verification and gates

Focused API positive/negative tests, typecheck/lint and relevant coverage remain at existing
thresholds. Existing adapter harness/isolation/structured tests establish unchanged policy at
their controlled level; they do not replace fresh native behavior QA. Independent QA must retain
the failed author attempts and establish healthy completion, disabled/global/node overrides,
fresh/resume/repair as appropriate, and missing-asset/unknown-ID behavior in local and D173
Git-sourced/local-transport lanes. No live remote HTTP/auth/marketplace service health is claimed.

The finite diagnosis has now run: two plugins-off controls completed cleanly; one subsequent
CLI-only healthy plugin control completed normally but exposed an invalid fixture `close` observer
assumption; after identifying the SDK's `removeAllListeners` behavior, the driver continued the
remaining twelve distinct scenarios without repeating that healthy control. Those twelve pass
with native `exit`/code0 plus owned-process absence, actual worker availability/tool invocation,
and clean harness completion. Keep the original observer assertion and the earlier two
unconfirmed app-server-associated attempts in review evidence. Same-session repair remains an
independent QA obligation if required by the final touched-system contract.

Opposite-family review, independent QA, normal exact-head/current-target CI and fresh final audit
remain coordinator gates. #439 and owner acceptance items remain open; no issue write/closure is
part of this proposal.
