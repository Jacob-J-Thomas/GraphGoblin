# Build a loop

## Edit the starter graph

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on the starter graph. Click **Edit** to open an existing loop.
2. Drag a node from the left palette onto the canvas, or click its palette button to add it below the lowest card's bottom with clearance for all its output ports. The canvas pans to the selected new node; existing nodes keep their positions. Hide collapses the palette to a rail, and Show expands it; its icon buttons still add nodes by click or Enter and can be dragged.
3. Click a node to edit it, or move to it with **Tab** and press **Enter**. Its editor opens in a dialog named **Edit _kind_ _id_**: set its ID, label, and config. IDs start with a letter and contain letters, digits, underscores, or hyphens; keep them unique. Dragging a node moves it without opening the dialog.
4. Remove the starter edge before inserting your own path. Use **Connections** in the node's dialog to remove an edge, or select the edge on the canvas and press **Delete** or **Backspace**.
5. Drag from a labelled output handle to the next node's input handle, or use the dialog's **Connect** form, which is the keyboard path: pick one of the node's free outputs and a target. **Delete node** in the dialog removes the node and its edges.
6. Use the **Loop settings** panel on the right for the loop's name, description, workspace, defaults, limits, and declared variables. Its Show and Hide buttons collapse or expand it.

Structured edits in the dialog save as you type; section JSON saves when applied, and unfinished text stays in this editing session when closing: use **Done**, the close button, **Esc**, or a click outside it, and focus returns to the node. An ID you are still typing applies when the dialog closes; an ID that cannot apply keeps the dialog open once with the reason, and closing again keeps the old ID. **Delete** and **Backspace** inside the dialog only edit text. While the dialog is open the rest of the editor waits, so close it to reach **Publish** or the palette. Below 768 px wide the dialog is a sheet along the bottom of the window.

**Undo** and **Redo** at the start of the toolbar's buttons take back or repeat a change to the loop: adding, moving, connecting, renaming, or deleting nodes, removing edges, rerouting or resetting a line, and edits to labels, config, the loop's name and description, settings, and variables. Each button's name says what it will change, for example **Undo move start**. **Ctrl+Z** undoes and **Ctrl+Shift+Z** or **Ctrl+Y** redoes (**Cmd+Z** and **Cmd+Shift+Z** on a Mac) with focus anywhere except a text field or a code editor, where the keys undo your typing in that field instead; on a checkbox, an option, a list, or a button they undo the editor. Typing in one field is one step, as is one drag; deleting a node and undoing brings back its edges and all connections to it, and discarding held input can be undone like any change. An undo is saved like any other edit. The editor keeps the last 100 steps for as long as it is open; reloading it or choosing **Reload server draft** starts afresh.

The **Palette** and **Loop settings** panels each have their own Show and Hide buttons. The browser remembers both choices; until you choose, the palette starts expanded on windows at least 1024 px wide and collapsed below, and the loop panel starts expanded at 1280 px and wider and collapsed below. Each collapsed panel keeps a narrow rail with its Show button. Validation stays in sight either way, on the nodes and beside **Publish** (see [Connect and validate](#connect-and-validate)).

Inference and provider decision forms have **Settings** and **Context** tabs. Use **Advanced** within either panel for less common controls; its count shows set values and problems. **Context** also shows how many context fields have a value of their own ("2 set"), with the same rules as Advanced, alongside its problem count. It contains inference input mutations and context files, or the decision's selected messages, variables and last-output settings. An issue opens the correct tab and Advanced group. Variable-name and mutation-pointer fields suggest declared loop variables while accepting other names or pointers allowed by their schemas. Criteria and rubric descriptions support multiple lines. Invalid numbers show their schema's reason and keep the last valid value saved until corrected or discarded.

An incomplete number such as `-` says **Enter a complete number**, keeps the last valid saved value and blocks **Publish**. Correct it or deliberately empty the field; an empty required field still needs a value. Held numeric input survives tab changes, undo/redo and closing/reopening in this editing session.

Use **Edit as JSON** for a substantial mutation list, context files, raw config overrides, capabilities, decision routes/rubric, or provider context. It starts with the section's current value; absent optional values start blank. Decision **Answer JSON** includes all routes and the rubric together, so related constraints can be checked; change the answer type with the structured picker. Edit the complete JSON, then choose **Apply JSON** to validate it as part of the complete current node config and save it, or **Cancel JSON** to return to the last applied value. An error names its path and keeps the old section saved, including parent rules such as Claude restrictions on raw overrides and custom capabilities. Fix other config errors before applying a section. If a field inside the section already holds unfinished input, entering JSON mode is refused: finish or discard the named fields, using **Focus first held field** to reach the first one. Switching back to the structured editor requires Apply or Cancel for a changed value or invalid JSON first, so unfinished JSON is never silently replaced. Whitespace and object-key ordering alone do not need Apply or block Publish. Changed values, including valid JSON waiting for Apply (described as JSON not applied yet), block **Publish** and survive tab changes, Advanced collapse, undo/redo, and closing/reopening the dialog in this editing session. Reloading the page has the existing held-text lifetime; it does not persist unfinished JSON. Capability slugs remain authored text because no resolved capability catalog is available yet; its notice appears once for the section.

For Answer JSON, retained route IDs keep their connections through reordering or ID swaps. An ID removed from the JSON loses its connections, including when you replace it with a new ID at the same route count. Apply first lists those connections by route ID and target node; choose **Confirm Apply JSON** to remove them and apply, or **Keep editing JSON** to reconsider. With nothing to remove, Apply saves at once. To rename a route and keep its connection, change the ID in the structured editor instead. Undo restores an applied Answer and its removed connections together.

The editor lives at this browser route:

<!-- guide-example: editor-url -->

```text
/app/loops/<loop-id>/edit
```

Edits autosave after a short debounce and are mirrored in IndexedDB. A schema-invalid draft stays on the device with **Saved on this device only**; fix it before relying on the server copy. Offline saves retry on reconnect. If another GraphGoblin tab or window from an older version holds the device's draft storage, a notice says so: close the other GraphGoblin tabs and windows. Until then, changes the server has not saved show as **Kept in this window only**, and closing the window loses them; saves to the server still work and show as **All changes saved**. Device drafts saved before the node-only harness change were discarded by a one-off store upgrade. This device's saved work opens while the server is loading; returning to a loop uses its latest copy in this window even if device storage is slow. The checking notice means editing is available while server saves and Publish wait for reconciliation. If you are offline, keep editing; recovery reconciles before saving. The save indicator claims a device copy only after its durable write succeeds.

If the server saved a newer draft, an untouched editor switches to it and offers **Use this device's copy instead** for the retained device work. Edits made while loading are kept in the editor. A stale base then asks you to reload or explicitly overwrite, rather than replacing those edits. Restore or discard failures keep the backup and offer a meaningful retry notice.

The restored-draft notice and notices about schema-invalid, offline, or failed saves can be dismissed. The toolbar continues to show when changes are kept only on this device or a save has failed. A dismissed restore notice stays hidden while editing that loaded draft and appears again if a later reload restores it. A dismissed save notice stays hidden through edits that end in the same state; it returns after a successful save, a different save problem or message, or a new load.

Every save tells the server which copy the edit started from. If another tab, device, or API client saved the draft in between, nothing is overwritten: **The draft changed on the server** appears (inside the node dialog too, when one is open), autosave stops, and you choose **Reload server draft** (take theirs, dropping this editor's unsaved changes and undo history and closing the dialog) or **Overwrite with this copy** (keep yours). Until you choose, edits stay on this device and **Publish** refuses. API clients get the same protection by sending `If-Match` with the `draftToken` from `GET /loops/{id}` (see [API, streaming, and MCP](../07-api-and-streaming.md#draft-conflicts-decided-wp-f2-adr-0015)).

## Choose nodes

Choose **Harness** in each inference node's dialog. It defaults to **Codex** when omitted; the current choices are **Codex** and **Claude**.
Loop settings offer model and effort defaults under **Defaults → By harness**. Remove `settings.defaults.harness` from older files before importing them.
If import is refused, the alert lists each invalid field's path and reason, including this removed field.

**Model** is a native dropdown of enabled catalog entries for the inference node's **Harness**, showing each display name and model id. **(loop default)** leaves the node's model unset; loop and owner defaults are scoped to each harness. The decision node's **LLM Model** and **Effort** selections remain Codex-only. Claude supports exact models `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-5-5`. Use **Model catalog in Settings** below the picker to enable an eligible model. A saved model from another harness is kept as a disabled entry labelled with its harness; choose a valid model once preflight passes, or select an inherited default. Switching to Claude resets the sandbox and approval policy to `read-only`/`never`; full access requires a separate explicit choice. Other authored harness options are preserved, with unsupported Claude settings reported for correction. There is no free-text option. Tab reaches the dropdown, then the Settings link; arrow keys change the selection and typing a name finds a matching entry. **Effort** offers the selected model's efforts, lowest first. **none (no reasoning)** is the lowest level: GPT-6 and GPT-5.6 models offer `none` to `max`, GPT-5.5 offers `low` to `xhigh`, and Claude offers `low`, `medium`, `high`, `xhigh`, and `max` (Claude Code has no level without reasoning). GraphGoblin sends `none` under the name the model's provider uses for that level; the run records `none`. An effort the selected model does not offer, for example `max` or `none` kept after switching a node to GPT-5.5, stays selected and is never changed for you: the field says which model does not support it, the node shows an issue in the editor's issue list, and the draft cannot be saved or published until you choose a supported effort or Default. The unset choice gives catalog guidance only; actual model and effort inherit in node, loop, owner, then process order within the selected harness.

A saved model that is missing or disabled stays selected with **not in catalog** or **disabled in the catalog** and a warning. An effort the selected model does not support stays selected and flagged too. Changing the model never changes effort silently. Catalog validation warnings appear beside the model field when they add information and do not block publishing. If the catalog cannot load, the current values remain in read-only dropdowns with one message and **Retry model catalog** beside Model; the pickers recover without changing saved values or dropping keyboard focus. A failed refresh keeps cached choices editable and warns that the catalog may be out of date.

**Trigger (`trigger`).** Choose **Trigger type**: **Manual**, **Cron**, **Poll**, **Event**, or **Webhook**. For manual starts, set `inputSchema` to validate input and `exposeTo` to declare intended `ui`, `api`, and `mcp` surfaces. The trigger records its payload as an output and follows `out`. Configure automatic sources in [Triggers](04-triggers.md).

> After 1.0: Surface-aware start and input controls. Today `exposeTo` is recorded and described to MCP callers, but the web launcher and engine commands do not enforce it. Use API authentication for access control.

**Decision (`decision`).** Choose **Expression**, **LLM** or **Classifier**. Expression edits one JSONata snippet and 2-64 named routes; it returns a declared route ID, such as `vars.done ? "done" : "retry"`. LLM edits Liquid instructions and the same readable routes, with Codex model/effort inheritance or explicit values. Its checked response names one route; confidence is informational, with no gate, and reasoning is a bounded excerpt.

Only classifiers choose **Choice**, **Noul** or **Score**. Choice keeps criteria and stable IDs; Noul keeps both sides' criteria and IDs, a true-probability threshold and separate minimum confidence. Score keeps fractional indices and complete routing bands: an interior boundary enters the next band, and the final endpoint is inclusive. Connect each declared route. Route IDs own connections; labels and display order can change independently. Use the up/down buttons to reorder routes, Choice options or Score bands. Changing an ID in the structured form carries its connections, including their manual line layouts. An unfinished or duplicate ID keeps ownership until repaired, including after reopening its device draft or restoring a set-aside copy.

**Changing kind or classifier answer type** opens a review before any edit. It lists fields and unfinished input that will be lost and the new fields to complete. **Cancel change** keeps everything; **Confirm change** makes one undoable edit. Compatible route IDs, labels, connections and provider context are retained, including unfinished route-field text when moving between kinds or classifier answer types. The loss preview names fields and routes; inherited provider defaults are not listed as lost settings. Choice to Noul maps the first route to true and the second to false, retaining their criteria; Noul refuses any route count other than two. New source, classifier selection, criteria and Score rubrics/bounds stay blank until you author them. Blank source or missing provider configuration blocks publication; choose its validation issue to focus the field. LLM model starts at **Default**, showing its inherited model id; Effort starts at **Default**, showing its resolved inherited value.

The selected port is `lastOutput.value.portId`, provider details are `lastOutput.value.provenance`, and evidence is `lastOutput.value.observation`. Route observations expose `routeId`; classifier observations expose typed `answer`. Questions/instructions render against the full thread; provider context selection does not restrict Liquid exposure. Invalid configurations have precise diagnostics and no evaluator fallback. Current definitions/exports use format 4; old exports/stores require the integrated cutover.

**Inference (`inference`).** Set `prompt.template` for a Codex or Claude turn. Choose `model`, `effort`, and `session.policy`: `fresh` (default), `resume-previous`, `resume-named` with a `key`, or opt-in `resume-own`. Codex supports `read-only`, `workspace-write` (default), and `danger-full-access`. Claude requires native Windows CLI 2.1.285 or newer with required capabilities and an explicit supported `read-only`/`never` or `danger-full-access`/`never` policy. Read-only restricts built-in tools but does not confine filesystem reads or the operating system; full access leaves commands and network unconfined under the API user's account. Claude refuses unsupported pairs, `networkAccess: false`, `webSearch: true`, custom capabilities, and nonempty raw configuration overrides. Use `input` transformations, `contextFiles`, and `output.transforms` to shape context. Set `output.schema.jsonSchema` for structured output and configure its `repair` policy. `output.captureTranscript` defaults to `artifact`, `output.toMessages` to `final`; `timeoutSeconds` is optional. The output goes to `lastOutput.value` and the node follows `out`.

> Capability profiles for `capabilities.mcpServers`, `capabilities.plugins`, and `capabilities.skills` remain unresolved for Codex; its adapter accepts `harnessOptions.configOverrides`. Claude refuses nonempty capabilities and nonempty raw overrides under its launch policy.

A loop turn does not start your machine's own extensions ([ADR-0063](../decisions/ADR-0063-loop-turns-without-personal-extensions.md)). Codex turns run without the MCP servers, plugins, ChatGPT apps, memories, goals, sub-agents, hooks and `notify` program in your Codex configuration. To use one of your Codex MCP servers in a node, set **Config overrides** (Settings tab, Advanced) to `{"mcp_servers": {"<name>": {"enabled": true}}}`. `{"features": {"plugins": true}}` turns all of your Codex plugins back on; one plugin alone cannot be turned on. `{"features": {"multi_agent": true}}` lets the turn spawn sub-agents again. Write every override key as plain segments of letters, digits, `_` and `-`. A key with any other character, or a segment named `__proto__`, `constructor` or `prototype`, makes the run fail before the turn starts. Claude turns always run without your Claude MCP servers, plugins, hooks and skills.

**Choosing inference context.** Use `fresh` for a new provider conversation with your
authored task and selected inputs. Include current loop context deliberately in
`prompt.template`, **Context** input transforms or `contextFiles`; fresh does not
mean an empty task. Use `resume-own` for an independent conversation owned by this
node within this run and harness. Later visits resume it, including after restart;
other nodes, runs, replay forks and child runs start their own conversations.
Previous/named keep their existing shared-session behavior.

Choosing `resume-own` reveals **Reset after visits** on Settings. Leave it blank for
no automatic reset, or enter a positive safe integer (1 to 9,007,199,254,740,991).
With 2, visits 1 and 2 share a conversation and visit 3 starts fresh. Retries and
repairs remain inside a visit. This clears only that node's provider conversation;
main-loop context and other nodes are kept. A missing provider session fails
explicitly; an explicit fresh-session recovery choice remains a later feature.

**Script (`script`).** Set an executable `command`, templated `args`, `cwd` (default `workspace`), and optional `env` and `timeoutSeconds`. Commands execute as the API's operating-system user, without a shell wrapper; invoke a shell explicitly if your program needs one. `stdin` accepts `thread`, `last-output`, or `none`; `stdout` accepts `last-output`, `patch` (RFC 6902), or `ignore`. In `env`, use the secret-reference syntax in [Settings and secrets](06-settings-and-secrets.md#store-secrets). Map expected nonzero codes through `exitCodeRoutes`; an unmapped nonzero code fails the run. Connect `out` and every additional route. Make scripts safe to execute again after interruption.

**Mutate (`mutate`).** Add at least one item to `operations`; each shows collapsed as its kind and path until you open it. Use `set` or `delete` with a JSON Pointer, `append-message`, `inject`, `truncate`, `drop`, `replace`, `redact`, or `coerce`. A `set.value` uses a `kind` of `literal`, `template`, or `expression`; each has its corresponding value, template, or JSONata field. Selection and replacement operations have their own `target` and filter fields. `coerce` validates a source value against `jsonSchema` and can request a Codex repair turn. Ordinary mutations modify context directly and follow `out`.

**Subloop (`subloop`).** Pick a published loop, then set `loopRef.loopId` and `loopRef.version` to `latest` or a published version number. Choose `input.mode`: `inherit`, `project`, or `fresh`; use exclusions, variable expressions, message/artifact selections, injected messages, and `input.trigger.payload` as needed. Choose `output.mode`: `result-only`, `merge`, or `custom`; configure `resultTo`, merge rules, or a custom patch expression. `output.usage` defaults to `roll-up`. The parent waits for the child, then follows `out`; `depthLimitOverride` can replace the loop's depth limit at this node.

**Wait (`wait`).** Choose `mode`: `input` with a Liquid `prompt` and optional `inputSchema`; `duration` with `seconds`; `until` with a Liquid `timestamp` that renders to a date; or `signal` with a `name` and optional JSONata `filter`. Input mode also declares `exposeTo`. Set optional `timeoutSeconds` and `onTimeout`: `continue` (default) or `fail-run`. Input and signal values become messages and the last output; a continuing timeout produces an object with `timedOut` true. The node parks, releases its worker, and follows `out` when it wakes.

**Heartbeat (`heartbeat`).** Set `intervalSeconds` and a `probe` of `http`, `script`, `signal-count`, or `none`. Supply at least one of `until` (JSONata), `maxBeats`, or `deadline` (Liquid timestamp). HTTP probes have method, URL, headers, body, and timeout fields; script probes have command, args, and timeout fields. The condition sees `probe`, `thread`, `beat`, and `now`. The first probe executes on entry; later beats park on timers. Choose `record` of `summary` or `full`, and `onExhausted` of `continue` or `fail-run`; completion follows `out`.

**Exit (`exit`).** Exits are terminal: `{outcome, returns, destinations}`. `outcome` is `success` (default), `failure` or `exhausted`; `returns` is a JSONata expression or `none` (default); `destinations` defaults to `[{kind:"caller"}]` and supports caller, webhook, file and log. To use another loop's result, call it with a Subloop node rather than publishing an Event. Exits have no criteria, predicate, default routing or loop-back, and no output ports.

Success finishes `succeeded`, Failure finishes `failed`, and Exhausted finishes the distinct terminal status `exhausted`. Exhausted means the authored graph gave up further repetition; normally a gate's Limit reached output leads here. It is an outcome, not a resumable node failure. Every outcome evaluates the same return expression and delivers its value unchanged; Exhausted adds no wrapper or implicit last output. Use `outputs.<workNodeId>.value` when returning work output, because the preceding gate replaces `lastOutput`.

## Connect and validate

Decision outputs connect by stable route **ID**, using the canvas handle or **Connections** in the dialog. Readable labels can be renamed and rows reordered without changing identity. Removing a connected route first lists its connections for confirmation, including when its ID is unfinished; confirmation removes the route and its owned connections in one undoable edit. **Undo** and **Redo** restore the route, unfinished input and connections together. Section JSON matches surviving IDs, so an ID replaced in JSON loses its connections after a separate removal review. Blank or duplicate IDs and labels block publication.

Connect exactly one edge per output port. Multiple inputs may converge on a node, but each run follows one route at a time. Triggers have no input. Ordinary output ports are `out`, decision ports are route IDs, script ports include exit-code labels, and gates add `limit-reached` and exits have no outputs. Edge targets use `in`.

Mark **Repeat route** on the decision route that leads back through work to the same gate. Set **Maximum passes** and optionally **Maximum run time (seconds)**; connect **Limit reached** to an Exhausted exit. A non-repeat choice on the last pass wins. Read `gates.<nodeId>.passes` in expressions. Unmarking previews removal of limits and the Limit reached edge, then applies them together with Undo support.

Loop-backs and connections whose output tip is to the right of the input follow square paths with rounded corners; small moves do not flip their shape. Return lanes sit at least 32 px from cards, with 24 px clearance at rounded corners. Inner spans get lanes first, and connections keep separate vertical trunks. Free lanes with 24 px separation always take priority; crowded gaps compress or share lanes only when those candidates are exhausted, and labels move along the lane to stay apart. Tight neighbours reduce clearance only on the endpoint approaches, keeping the lane and label away from the cards. Leave at least **8 px between facing card bodies** for the protruding handles; there is no 64 px minimum spacing. Moving a card remains one Undo step, and moving it back restores the same route. The loop-back keeps its moving dash, with its label on a straight segment; long names retain their full accessible name and hover title. Click an edge, or focus it and press Enter, then Delete to remove it; Undo restores it. **Port covered by a card; move the card** means another card covers the actual handle; **No clear route; move a card** means the bounded router could not find an escape.

A loop-back can also point to a card on its right. A clear Z or step path stays drawn even when it has no middle horizontal segment: its label uses another horizontal segment or a clear position above the path. Label placement never removes a valid connection.

To move a line out of the way, select it (click it, or move to it with **Tab** and press **Enter**). A round handle appears on each of its horizontal and vertical segments, the loop-back's return lane included. Drag a handle to move that segment: the line stays square and its ends stay on their ports. Dragging the short end piece next to a port keeps a stub on the port and bends the rest, which is how you take a straight line around a card. With the keyboard, press **Tab** from the selected line to reach its handles, then the arrow keys along the segment (Left and Right for an upright segment, Up and Down for a level one) to move it one grid step, or five with **Shift**; **Esc** returns to the line. Each drag, and each run of arrow presses, is one **Undo** step. The editor keeps where you put a segment, even across a card (the line is then dotted, so you can finish rerouting it); **Reset route** above the line's label returns it to automatic routing. If moving a card onto a manual route leaves its automatic replacement clear of every card, the route returns to automatic routing as part of the move, and **Undo** brings both back. If that replacement would cross a card, the manual route is kept and shown dotted with **Crosses a card**; use **Reset route** to drop it. Your routes are saved with the loop: they survive reloads, export and import, and publishing, and runs ignore them.

Check validation after every change. A node with problems shows an issue badge in its header: a cross when any of them is an error, a warning triangle when they are all warnings, and the count when there are several. Hover the badge, move to it with **Tab**, or click it to list each issue with its severity, message, and field; the list stays open while the pointer is over it or focus is inside it, a click keeps it open, and **Esc** closes it. Choose an issue to open the node's dialog with that field focused; an issue without a field opens the dialog at its top. The same badge sits beside the dialog's title while you edit. Beside **Publish**, the toolbar shows the loop's error and warning counts; click them for the issues that belong to the whole loop or to an edge, then a row per node with issues, which opens that node. With nothing to list it shows **Ready to publish** once the server has checked the saved draft (cron expressions, subloop references), **Checking…** until then, and **Validation unavailable** when the server could not be asked (offline, say); **Publish** runs the checks again either way. Text that does not parse in a JSON field is an issue too, with **Discard the unparsed text** in its row. An incomplete cron schedule uses **Discard the incomplete schedule**; valid section JSON waiting for Apply says it is **JSON not applied yet**, with **Discard the unapplied JSON** available in its issue row. These actions clear the held input and can be undone.

Fix errors before publishing: missing trigger or exit, unconnected or doubly connected ports, duplicate IDs, invalid targets or ports, unreachable nodes, a trigger with no path to an exit, undeclared variables, a noncyclic repeat, missing gate limits or an unconnected Limit reached. The server repeats these checks on publication and returns HTTP 422 `LOOP_INVALID`.

## Set workspace and limits

| Setting               | Configure it                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxNodeVisits`       | Default 10, range 1 to 10,000. Safety cap against unintended cycles; exceeding fresh visits per node fails `MAX_NODE_VISITS`. Intentional repeats use a decision gate.                                         |
| `runDeadlineSeconds`  | Default null (no run deadline), range 1 to 31,536,000 seconds when Limited. Includes waits, pauses and downtime; expiry fails `RUN_DEADLINE_EXCEEDED`.                                                         |
| `structuredTimeoutMs` | Default null (Unlimited), range 1 to 31,536,000,000 milliseconds when Limited. Bounds each LLM decision or structured repair completion; expiry fails `STRUCTURED_COMPLETION_TIMEOUT`.                         |
| `workingDirectory`    | `temp` (default), `fixed` with `path`, or `template` with a Liquid `template`. The filesystem adapter creates the resolved directory if needed.                                                                |
| `subloopDepthLimit`   | Default 8, range 1 to 64. A subloop node can replace it with `depthLimitOverride`.                                                                                                                             |
| `defaults`            | Set optional model and effort under `byHarness.codex` or `byHarness.claude`. Node values override that harness's loop defaults, then owner and API-process defaults. Harness is chosen on each inference node. |

For a repository workspace, use an absolute path. For a temporary workspace, use:

<!-- guide-example: temp-settings -->

```json
{
  "workingDirectory": { "kind": "temp" },
  "defaults": { "byHarness": { "codex": { "model": "gpt-6-luna", "effort": "low" } } },
  "maxNodeVisits": 3,
  "subloopDepthLimit": 8
}
```

Declare variable names and JSON Schemas in **Variables**; initialise their values with a mutation or mapping.

Empty or whitespace-only optional JSONata expressions count as absent and show no preview. Required blank expressions show the schema's error, with **Required** as a fallback, and omit the preview; the editor retains the typed whitespace. Liquid templates preserve their text exactly, including whitespace and required empty strings (for example, an empty script argument or a single-space delimiter). Only exactly empty optional template input means absent in the form. Imports and API clients that supply blank expressions receive a validation error before publishing; omit optional expressions instead. Supplied empty and whitespace-only templates remain valid.

The forms draw each field by its type. An asterisk (*) marks a field you must fill (screen readers hear "required"), and a list or set of options that needs entries says how many ("At least 2 items.", "Choose at least 1."); a problem shows under its field; a field with a default shows it as a placeholder or as the initial choice. An on/off setting with a default is a switch; one that may stay unset offers **Not set**, **Yes**, and **No**. A choice of two to four options is a row of segments (Tab reaches the chosen one and the arrow keys move it), a longer one a dropdown, and an optional choice keeps **Not set**. Liquid, JSONata, and JSON fields are code editors tagged with their language; **Tab** and **Shift+Tab** leave them as from any other field.

Inference, decision, script and subloop forms keep optional controls under **Advanced**, grouped by purpose. In inference, model and effort stay visible on **Settings** with harness, session policy/key, prompt and sandbox. LLM decisions also show model and effort on Settings. Effort is one dropdown: **Default (high)** shows the inherited value, followed by the effective model's supported choices. Choose Default to clear an explicit override; resolution is node, then loop, then Settings, then process defaults. Classifiers keep Question, Model, then Answer and have no effort control. Open **Context** for `input` mutations, and **Context ? Advanced ? Files** for `contextFiles`. In provider decisions, **Context** holds message selection and last output; **Context ? Advanced ? Provider context** holds variable selection. Expression decisions have no Context tab. Decision answers/routes and required evaluator inputs stay visible on Settings; classifier confidence and Noul thresholds are under **Advanced ? Acceptance** inside Evaluation, with alternative recording under the form's **Advanced ? Recording**. Shared exit evaluators use the same nested threshold placement on their single panel.

Use Left/Right, Home and End on the tabs; Tab leaves the tablist for the selected panel. Both panels keep your edits and unparsed text when switching. Tabs and Advanced show problem counts; Context and Advanced also count fields with values of their own. Choosing an issue opens the right tab and group at its field. Undo/Redo preserve your current tab and open groups; reopening starts on Settings. On large screens the node editor grows at 1024 and 1280 px; below 768 px it remains a full-width bottom sheet.

**Advanced** opens with Enter or Space and says how many options have values or problems. A mutate node's operations (and inference input/output transforms) are collapsed to one line each, their kind and path, with any problem flagged; an added operation opens ready to fill in. Each option's help comes from the [node reference](../reference/nodes.md).

**Add** moves focus to the new collection item's first control; **Remove** returns focus to that collection's Add button. Each action is announced. Removing a row drops its unparsed JSON and validation issue, while surviving text follows its own row. Renaming a record key keeps unparsed text and moves its issue to the new key. A key that already exists shows an inline error and keeps your typed key for correction, while both saved values remain intact.

## Publish, import, and export

Click **Publish** to save the draft and freeze a numbered version. Runs pin a version; later edits and publications do not change runs already started. Publishing also arms automatic triggers for the new version. The editor shows the current published version; the API exposes version history:

<!-- guide-example: version-requests -->

```http
GET /loops/{id}/versions
GET /loops/{id}/versions/{versionId}
```

Use **Export** on the Loops page to download JSON. It exports the published definition when one exists, otherwise the draft. To export unpublished changes explicitly, request:

<!-- guide-example: export-request -->

```http
GET /loops/{id}/export?draft=true
```

Each Loops row groups **Edit**, **Export**, and **Delete** as buttons; Edit opens the editor. Export shows **Exporting…** while pending, keeps keyboard focus, and accepts one request at a time. Delete opens a confirmation naming the loop: the loop, all its versions, triggers and runs are deleted, including run history and artifact references (the run count is shown when the listing is complete), and loops using it as a subloop can no longer start it. Cancel queued, running, waiting or paused runs first. Shared artifact files remain on disk. This cannot be undone. Choose **Keep** or press Escape to cancel while idle, or **Confirm delete** to remove it. A 409 `LOOP_IN_USE` keeps the API's reason visible in the confirmation until you dismiss it or retry. Confirmation and Keep are disabled while the request is pending; repeated Escape presses cannot dismiss it.

Use the Loops page's file picker, or `POST /loops/import`, to import an export envelope or a bare definition.

<!-- guide-example: import-request -->

```http
POST /loops/import
```

Import always creates a new loop with a draft, even if the name matches an existing loop. To update an existing loop, save its draft through the editor or API:

<!-- guide-example: draft-request -->

```http
PUT /loops/{id}/draft
```

The body wraps your definition:

<!-- guide-example: draft-body -->

```json
{
  "definition": {
    "schemaVersion": 4,
    "name": "starter",
    "nodes": [
      { "id": "start", "kind": "trigger", "label": "Start", "config": { "type": "manual" } },
      { "id": "done", "kind": "exit", "label": "Done", "config": {} }
    ],
    "edges": [
      {
        "id": "e1",
        "from": { "node": "start", "port": "out" },
        "to": { "node": "done", "port": "in" }
      }
    ]
  }
}
```

After saving the draft, publish it with this bodyless request. Omit `Content-Type` when there is no body:

<!-- guide-example: publish-request -->

```http
POST /loops/{id}/publish
```

## Import a complete first loop

Save this bare definition as a JSON file and import it. It follows the contracts' minimal trigger-to-exit fixture with an inference node inserted, and uses the fields and defaults of `LoopDefinitionSchema`. Publish it, select **Open in Runs**, and supply a topic. Replace the model if your Codex account uses another ID. Running it uses your authenticated Codex account and consumes usage.

<!-- guide-example: first-summary -->

```json
{
  "schemaVersion": 4,
  "name": "first-summary",
  "description": "Ask Codex for a short explanation of a topic.",
  "settings": {
    "workingDirectory": { "kind": "temp" },
    "defaults": { "byHarness": { "codex": { "model": "gpt-6-luna", "effort": "low" } } },
    "maxNodeVisits": 3,
    "subloopDepthLimit": 8
  },
  "variables": {},
  "nodes": [
    {
      "id": "start",
      "kind": "trigger",
      "label": "Start",
      "ui": { "x": 0, "y": 80 },
      "config": {
        "type": "manual",
        "exposeTo": ["ui", "api", "mcp"],
        "inputSchema": {
          "type": "object",
          "properties": { "topic": { "type": "string", "minLength": 1 } },
          "required": ["topic"],
          "additionalProperties": false
        }
      }
    },
    {
      "id": "summarise",
      "kind": "inference",
      "label": "Summarise",
      "ui": { "x": 280, "y": 80 },
      "config": {
        "harness": "codex",
        "session": { "policy": "fresh" },
        "prompt": { "template": "Explain {{ trigger.payload.topic }} in three sentences." },
        "harnessOptions": { "sandbox": "read-only", "approval": "never" },
        "output": { "captureTranscript": "artifact", "toMessages": "final" },
        "timeoutSeconds": 300
      }
    },
    {
      "id": "done",
      "kind": "exit",
      "label": "Done",
      "ui": { "x": 560, "y": 80 },
      "config": {
        "outcome": "success",
        "returns": "{ \"summary\": outputs.summarise.value }",
        "destinations": [{ "kind": "caller" }]
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": { "node": "start", "port": "out" },
      "to": { "node": "summarise", "port": "in" }
    },
    {
      "id": "e2",
      "from": { "node": "summarise", "port": "out" },
      "to": { "node": "done", "port": "in" }
    }
  ]
}
```

Read [Node catalog](../04-node-catalog.md) for design context. Continue with [Run and observe](03-run-and-observe.md).

## Author a bounded repeat

A decision becomes a gate when exactly one route is marked `repeat: true`. This marker belongs on an expression/LLM route, Choice option, Noul side or Score band; it is never inferred from canvas direction. Require `maxPasses` (1–10,000); optionally set `maxRunTimeSeconds` (positive integer seconds, at most 31,536,000). Without a repeat marker neither limit is allowed. Reserve the port ID `limit-reached`: authors cannot use it as a route ID. The gate exposes **Limit reached** only while a repeat is marked, and that output must be connected. The repeat route must lead through a cycle back to the gate; exits are terminal and triggers cannot be repeat targets.

Passes are one-based, available to JSONata as `gates.<nodeId>.passes` (quote an ID with punctuation, for example `gates."my-gate".passes`). Every marked gate starts at 1. Evaluation happens first. An allowed repeat increments its count once; a non-repeat choice or a refused repeat leaves it unchanged. A non-repeat choice on the last allowed pass wins. If the decision chooses repeat at `maxPasses`, or after the optional run-time limit, it takes `limit-reached` instead. Both limits reached together are recorded as `max-passes`.

Maximum run time is elapsed wall time from `run.startedAt` (falling back to `createdAt`), including waits, pauses and recovery downtime. It is checked after evaluation and only on a repeat choice; it does not interrupt running work or override a finishing choice. A replay fork keeps the checkpoint's passes and starts its own run clock.

Use **Outcome: Exhausted** on the exit connected to Limit reached. A normal Done route can lead to Success or Failure. The inspector keeps the evaluator's choice, actual port and pass count together.

Save and import this complete deterministic example as `bounded-repeat.json`, then publish it and send `{ "triggerNodeId": "start", "input": {} }` as the JSON request body to `POST /loops/{id}/runs`. It appends a note on each of three passes, always requests another pass, then takes `limit-reached`. The documented result is status `exhausted`, outcome `exhausted`, and result `{ "passes": 3 }`. It needs no provider.

<!-- guide-example: bounded-repeat -->

```json
{
  "schemaVersion": 4,
  "name": "bounded-repeat",
  "settings": { "workingDirectory": { "kind": "temp" } },
  "nodes": [
    { "id": "start", "kind": "trigger", "label": "Start", "config": { "type": "manual" } },
    {
      "id": "work",
      "kind": "mutate",
      "label": "Record pass",
      "config": {
        "operations": [{ "op": "append-message", "role": "note", "content": "One pass" }]
      }
    },
    {
      "id": "gate",
      "kind": "decision",
      "label": "Repeat at most three passes",
      "config": {
        "kind": "expression",
        "jsonata": "\"repeat\"",
        "routes": [
          { "id": "repeat", "label": "Repeat", "repeat": true },
          { "id": "done", "label": "Done" }
        ],
        "maxPasses": 3
      }
    },
    { "id": "done", "kind": "exit", "label": "Done", "config": {} },
    {
      "id": "exhausted",
      "kind": "exit",
      "label": "Exhausted",
      "config": {
        "outcome": "exhausted",
        "returns": "{ \"passes\": gates.gate.passes }",
        "destinations": [{ "kind": "caller" }]
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": { "node": "start", "port": "out" },
      "to": { "node": "work", "port": "in" }
    },
    {
      "id": "e2",
      "from": { "node": "work", "port": "out" },
      "to": { "node": "gate", "port": "in" }
    },
    {
      "id": "e3",
      "from": { "node": "gate", "port": "repeat" },
      "to": { "node": "work", "port": "in" }
    },
    {
      "id": "e4",
      "from": { "node": "gate", "port": "done" },
      "to": { "node": "done", "port": "in" }
    },
    {
      "id": "e5",
      "from": { "node": "gate", "port": "limit-reached" },
      "to": { "node": "exhausted", "port": "in" }
    }
  ]
}
```

Changing a node ID updates its connections. Update authored references such as `gates."old-id".passes` and `outputs."old-id".value` yourself.

To find a reference, expand **Earlier node outputs (N)** under a template or expression field in the node dialog. It lists the nodes that can run before this one, nearest first, each with its reference in that field's syntax, a **Copy** button and a note on what it outputs. For example, a script's default output is its stdout itself, parsed as JSON when possible: `42`, not `{stdout: 42}`. IDs with a hyphen are quoted for you: `{{ outputs["old-id"].value }}` in Liquid and `outputs."old-id".value` in JSONata.

The list is help, not validation. A branch may not run, and a node marked **previous visit** has no value the first time through. Nodes that write no output, such as Mutate and Exit, are left out. Fields evaluated against something other than the run thread show no list; these include trigger fields, a wait's signal filter, a heartbeat's stop condition, subloop output mappings, and the `where` predicates of message and artifact selectors and mutations, which see one item at a time.

### Visible execution limits

In the editor's Loop tab, Maximum node visits defaults to 10 and No run deadline is
selected by default. Settings also lists these defaults. To add a deadline, choose
Limited and enter seconds (the suggested value is 3600). With no deadline, long waits,
heartbeats and polling runs continue until an authored exit, Cancel or another explicit
limit/failure. Choose Unlimited visits explicitly to remove the visit cutoff; its warning
explains that authored exits and Cancel remain available.
Marked repeat decisions use Maximum passes; choose Unlimited there for indefinite passes.
Existing authored gate time checks and node timeouts still apply. The run inspector's
Execution limits card shows the pinned values and absolute deadline, even after edits.
An authored deadline includes waits, pauses and downtime; expiry fails RUN_DEADLINE_EXCEEDED.

Structured completion milliseconds is independently Unlimited by default. Choose Limited
and enter milliseconds (the suggestion is 120000) to bound each LLM decision evaluation
or output-transform repair through the structured port. Same-session inference schema
repairs follow the node timeout and run deadline. The limit is pinned on the run. Expiry aborts the call, releases capacity and
fails `STRUCTURED_COMPLETION_TIMEOUT`, naming the configured milliseconds. Late results
are discarded. Unlimited removes this cutoff; explicit Cancel and other authored limits
still apply. This is an execution deadline, not a usage budget.

Provider/service limits can still fail a run. Quota exhaustion fails explicitly; GraphGoblin
has no cost, token, subscription or provider-turn budget. Authors can implement usage-aware
script/decision nodes. Only a positively unsubmitted transient transport failure retries
once; uncertain accepted work is never blindly resent.
