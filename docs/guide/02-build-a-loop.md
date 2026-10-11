# Build a loop

## Edit the starter graph

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on the starter graph. Click **Edit** to open an existing loop.
2. Drag a node from the left palette onto the canvas, or click its palette button to add it. Hide collapses the palette to a rail, and Show expands it; its icon buttons still add nodes by click or Enter and can be dragged. The new node is selected.
3. Click a node to edit it, or move to it with **Tab** and press **Enter**. Its editor opens in a dialog named **Edit _kind_ _id_**: set its ID, label, and config. IDs start with a letter and contain letters, digits, underscores, or hyphens; keep them unique. Dragging a node moves it without opening the dialog.
4. Remove the starter edge before inserting your own path. Use **Connections** in the node's dialog to remove an edge, or select the edge on the canvas and press **Delete** or **Backspace**.
5. Drag from a labelled output handle to the next node's input handle, or use the dialog's **Connect** form, which is the keyboard path: pick one of the node's free outputs and a target. **Delete node** in the dialog removes the node and its edges.
6. Use the **Loop settings** panel on the right for the loop's name, description, workspace, defaults, limits, and declared variables. Its Show and Hide buttons collapse or expand it.

Edits in the dialog save as you type, so closing it never discards anything: use **Done**, the close button, **Esc**, or a click outside it, and focus returns to the node. An ID you are still typing applies when the dialog closes; an ID that cannot apply keeps the dialog open once with the reason, and closing again keeps the old ID. **Delete** and **Backspace** inside the dialog only edit text. While the dialog is open the rest of the editor waits, so close it to reach **Publish** or the palette. Below 768 px wide the dialog is a sheet along the bottom of the window.

**Undo** and **Redo** at the start of the toolbar's buttons take back or repeat a change to the loop: adding, moving, connecting, renaming, or deleting nodes, removing edges, rerouting or resetting a line, and edits to labels, config, the loop's name and description, settings, and variables. Each button's name says what it will change, for example **Undo move start**. **Ctrl+Z** undoes and **Ctrl+Shift+Z** or **Ctrl+Y** redoes (**Cmd+Z** and **Cmd+Shift+Z** on a Mac) with focus anywhere except a text field or a code editor, where the keys undo your typing in that field instead; on a checkbox, an option, a list, or a button they undo the editor. Typing in one field is one step, as is one drag; deleting a node and undoing brings back its edges and any loop-back to it, and discarding held input can be undone like any change. An undo is saved like any other edit. The editor keeps the last 100 steps for as long as it is open; reloading it or choosing **Reload server draft** starts afresh.

The **Palette** and **Loop settings** panels each have their own Show and Hide buttons. The browser remembers both choices; until you choose, the palette starts expanded on windows at least 1024 px wide and collapsed below, and the loop panel starts expanded at 1280 px and wider and collapsed below. Each collapsed panel keeps a narrow rail with its Show button. Validation stays in sight either way, on the nodes and beside **Publish** (see [Connect and validate](#connect-and-validate)).

The editor lives at this browser route:

```text
/app/loops/<loop-id>/edit
```

Edits autosave after a short debounce and are mirrored in IndexedDB. A schema-invalid draft stays on the device with **Saved on this device only**; fix it before relying on the server copy. Offline saves retry on reconnect. If another GraphGoblin tab or window from an older version holds the device's draft storage, a notice says so: close the other GraphGoblin tabs and windows. Until then, changes the server has not saved show as **Kept in this window only**, and closing the window loses them; saves to the server still work and show as **All changes saved**. Device drafts saved before the node-only harness change were discarded by a one-off store upgrade. An unsynced local draft takes precedence on reload, unless the server saved a newer draft since; then the server copy is shown and the device copy is offered with **Use this device's copy instead**.

The restored-draft notice and notices about schema-invalid, offline, or failed saves can be dismissed. The toolbar continues to show when changes are kept only on this device or a save has failed. A dismissed restore notice stays hidden while editing that loaded draft and appears again if a later reload restores it. A dismissed save notice stays hidden through edits that end in the same state; it returns after a successful save, a different save problem or message, or a new load.

Every save tells the server which copy the edit started from. If another tab, device, or API client saved the draft in between, nothing is overwritten: **The draft changed on the server** appears (inside the node dialog too, when one is open), autosave stops, and you choose **Reload server draft** (take theirs, dropping this editor's unsaved changes and undo history and closing the dialog) or **Overwrite with this copy** (keep yours). Until you choose, edits stay on this device and **Publish** refuses. API clients get the same protection by sending `If-Match` with the `draftToken` from `GET /loops/{id}` (see [API, streaming, and MCP](../07-api-and-streaming.md#draft-conflicts-decided-wp-f2-adr-0015)).

## Choose nodes

Choose **Harness** in each inference node's dialog. It defaults to **Codex** when omitted; the current choices are **Codex** and **Claude**.
Loop settings offer model and effort defaults under **Defaults → By harness**. Remove `settings.defaults.harness` from older files before importing them.
If import is refused, the alert lists each invalid field's path and reason, including this removed field.

**Model** is a native dropdown of enabled catalog entries for the inference node's **Harness**, showing each display name and model id. **(loop default)** leaves the node's model unset; loop and owner defaults are scoped to each harness. The decision node's **Codex → Model** and **Effort** remain Codex-only. Claude supports exact models `claude-opus-5-5` and `claude-fable-5-1`. Use **Model catalog in Settings** below the picker to enable an eligible model. A saved model from another harness is kept as a disabled entry labelled with its harness; choose a valid model once preflight passes, or select an inherited default. Switching to Claude resets the sandbox and approval policy to `read-only`/`never`; full access requires a separate explicit choice. Other authored harness options are preserved, with unsupported Claude settings reported for correction. There is no free-text option. Tab reaches the dropdown, then the Settings link; arrow keys change the selection and typing a name finds a matching entry. **Effort** offers the selected model's efforts: Claude supports `low`, `medium`, `high`, `xhigh`, and `max` (not `minimal`); Codex has its own catalog choices. The unset choice gives catalog guidance only; actual model and effort inherit in node, loop, owner, then process order within the selected harness.

A saved model that is missing or disabled stays selected with **not in catalog** or **disabled in the catalog** and a warning. An effort the selected model does not support stays selected and flagged too. Changing the model never changes effort silently. Catalog validation warnings appear beside the model field when they add information and do not block publishing. If the catalog cannot load, the current values remain in read-only dropdowns with one message and **Retry model catalog** beside Model; the pickers recover without changing saved values or dropping keyboard focus. A failed refresh keeps cached choices editable and warns that the catalog may be out of date.

**Trigger (`trigger`).** Choose `subtype`: `manual`, `cron`, `webhook`, `event`, or `poll`. For manual starts, set `inputSchema` to validate input and `exposeTo` to declare intended `ui`, `api`, and `mcp` surfaces. The trigger records its payload as an output and follows `out`. Configure automatic sources in [Triggers](04-triggers.md).

> After 1.0: Surface-aware start and input controls. Today `exposeTo` is recorded and described to MCP callers, but the web launcher and engine commands do not enforce it. Use API authentication for access control.

**Decision (`decision`).** Choose an answer: **Noul** for true/false, **Choice** for named options, or **Score** for a position on an ordered rubric. Noul gives both sides criteria and labelled ports; Choice gives each option criteria and a stable ID; Score gives the anchors and complete routing bands. Labels and order can change without moving a connection. Connect every declared route.

Choose **Expression**, **Classifier**, or **LLM** to evaluate it. Expression returns a strict boolean for Noul or a declared ID for Choice. LLM uses Codex for those two answers. Score requires a Score-capable classifier and retains fractional values. Classifier Noul separates **Truth threshold** (which side) from **Minimum confidence** (whether to accept the selected side). Score bands include their lower boundary; only the last band includes its upper boundary. Results are under `lastOutput.value.answer`, the selected route is `lastOutput.value.portId`, and provider details are in `lastOutput.value.provenance`.

Questions still render against the full thread; the separate context selector keeps its existing behavior and does not limit template exposure. Unsupported capabilities, unavailable configuration, malformed answers and rejected classifier confidence have precise diagnostics. No other evaluator runs as fallback.

**Inference (`inference`).** Set `prompt.template` for a Codex or Claude turn. Choose `model`, `effort`, and `session.policy`: `fresh`, `resume-previous`, or `resume-named` with a `key`. Codex supports `read-only`, `workspace-write` (default), and `danger-full-access`. Claude requires native Windows CLI 2.1.285 or newer with required capabilities and an explicit supported `read-only`/`never` or `danger-full-access`/`never` policy. Read-only restricts built-in tools but does not confine filesystem reads or the operating system; full access leaves commands and network unconfined under the API user's account. Claude refuses unsupported pairs, `networkAccess: false`, `webSearch: true`, custom capabilities, and nonempty raw configuration overrides. Use `input` transformations, `contextFiles`, and `output.transforms` to shape context. Set `output.schema.jsonSchema` for structured output and configure its `repair` policy. `output.captureTranscript` defaults to `artifact`, `output.toMessages` to `final`; `timeoutSeconds` is optional. The output goes to `lastOutput.value` and the node follows `out`.

> Capability profiles for `capabilities.mcpServers`, `capabilities.plugins`, and `capabilities.skills` remain unresolved for Codex; its adapter accepts `harnessOptions.configOverrides`. Claude refuses nonempty capabilities and nonempty raw overrides under its launch policy.

**Script (`script`).** Set an executable `command`, templated `args`, `cwd` (default `workspace`), and optional `env` and `timeoutSeconds`. Commands execute as the API's operating-system user, without a shell wrapper; invoke a shell explicitly if your program needs one. `stdin` accepts `thread`, `last-output`, or `none`; `stdout` accepts `last-output`, `patch` (RFC 6902), or `ignore`. In `env`, use the secret-reference syntax in [Settings and secrets](06-settings-and-secrets.md#store-secrets). Map expected nonzero codes through `exitCodeRoutes`; an unmapped nonzero code fails the run. Connect `out` and every additional route. Make scripts safe to execute again after interruption.

**Mutate (`mutate`).** Add at least one item to `operations`; each shows collapsed as its kind and path until you open it. Use `set` or `delete` with a JSON Pointer, `append-message`, `inject`, `truncate`, `drop`, `replace`, `redact`, or `coerce`. A `set.value` uses a `kind` of `literal`, `template`, or `expression`; each has its corresponding value, template, or JSONata field. Selection and replacement operations have their own `target` and filter fields. `coerce` validates a source value against `jsonSchema` and can request a Codex repair turn. Ordinary mutations modify context directly and follow `out`.

**Subloop (`subloop`).** Pick a published loop, then set `loopRef.loopId` and `loopRef.version` to `latest` or a published version number. Choose `input.mode`: `inherit`, `project`, or `fresh`; use exclusions, variable expressions, message/artifact selections, injected messages, and `input.trigger.payload` as needed. Choose `output.mode`: `result-only`, `merge`, or `custom`; configure `resultTo`, merge rules, or a custom patch expression. `output.usage` defaults to `roll-up`. The parent waits for the child, then follows `out`; `depthLimitOverride` can replace the loop's depth limit at this node.

**Wait (`wait`).** Choose `mode`: `input` with a Liquid `prompt` and optional `inputSchema`; `duration` with `seconds`; `until` with a Liquid `timestamp` that renders to a date; or `signal` with a `name` and optional JSONata `filter`. Input mode also declares `exposeTo`. Set optional `timeoutSeconds` and `onTimeout`: `continue` (default) or `fail-run`. Input and signal values become messages and the last output; a continuing timeout produces an object with `timedOut` true. The node parks, releases its worker, and follows `out` when it wakes.

**Heartbeat (`heartbeat`).** Set `intervalSeconds` and a `probe` of `http`, `script`, `signal-count`, or `none`. Supply at least one of `until` (JSONata), `maxBeats`, or `deadline` (Liquid timestamp). HTTP probes have method, URL, headers, body, and timeout fields; script probes have command, args, and timeout fields. The condition sees `probe`, `thread`, `beat`, and `now`. The first probe executes on entry; later beats park on timers. Choose `record` of `summary` or `full`, and `onExhausted` of `continue` or `fail-run`; completion follows `out`.

**Exit (`exit`).** Evaluate `criteria` in order using `max-iterations`, `max-duration`, `predicate`, or `last-output-matches`. Choose `default` of `success` or `loop-back`; the latter needs `loopBack.targetNodeId` and a matching edge. Set `return.mapping` to a JSONata expression and choose `return.channels`; `none` omits the payload. A terminal exit has no output port; a configured loop-back exposes `loopBack`. The loop's iteration ceiling is checked when the exit evaluates, so route repeated work through an exit to bound it.

## Connect and validate

Decision outputs are ready to connect as soon as you add or rename a route, by dragging its handle or using **Connections** in the node dialog; no reload is needed. Renaming a connected route keeps its connection and any manual line layout. While editing incomplete labels, each connection stays with its own row, whichever row you finish first. Removing a route removes its connection even if its label is temporarily blank or invalid, and reordering keeps connections with their labels. **Undo** and **Redo** restore the route edit and its connection together. Blank or duplicate labels still need fixing before you can publish.

Connect exactly one edge per output port. Multiple inputs may converge on a node, but each run follows one route at a time. Triggers have no input. Ordinary output ports are `out`, decision ports are route labels, script ports include exit-code labels, and exit ports are limited to `loopBack`. Edge targets use `in`.

For a loop-back, connect the exit handle to a working node, such as inference or mutation. The canvas sets `loopBack.targetNodeId` for you; it cannot target a trigger or another exit. Only this exit transition increments the iteration. A cycle through other nodes does not consume the iteration limit.

Loop-backs and connections whose output tip is to the right of the input follow square paths with rounded corners; small moves do not flip their shape. Return lanes sit at least 32 px from cards, with 24 px clearance at rounded corners. Inner spans get lanes first, and connections keep separate vertical trunks. Free lanes with 24 px separation always take priority; crowded gaps compress or share lanes only when those candidates are exhausted, and labels move along the lane to stay apart. Tight neighbours reduce clearance only on the endpoint approaches, keeping the lane and label away from the cards. Leave at least **8 px between facing card bodies** for the protruding handles; there is no 64 px minimum spacing. Moving a card remains one Undo step, and moving it back restores the same route. The loop-back keeps its moving dash, with its label on a straight segment; long names retain their full accessible name and hover title. Click an edge, or focus it and press Enter, then Delete to remove it; Undo restores it. **Port covered by a card; move the card** means another card covers the actual handle; **No clear route; move a card** means the bounded router could not find an escape.

A loop-back can also point to a card on its right. A clear Z or step path stays drawn even when it has no middle horizontal segment: its label uses another horizontal segment or a clear position above the path. Label placement never removes a valid connection.

To move a line out of the way, select it (click it, or move to it with **Tab** and press **Enter**). A round handle appears on each of its horizontal and vertical segments, the loop-back's return lane included. Drag a handle to move that segment: the line stays square and its ends stay on their ports. Dragging the short end piece next to a port keeps a stub on the port and bends the rest, which is how you take a straight line around a card. With the keyboard, press **Tab** from the selected line to reach its handles, then the arrow keys along the segment (Left and Right for an upright segment, Up and Down for a level one) to move it one grid step, or five with **Shift**; **Esc** returns to the line. Each drag, and each run of arrow presses, is one **Undo** step. The editor keeps where you put a segment, even across a card (the line is then dotted, so you can finish rerouting it); **Reset route** above the line's label returns it to automatic routing. If moving a card onto a manual route leaves its automatic replacement clear of every card, the route returns to automatic routing as part of the move, and **Undo** brings both back. If that replacement would cross a card, the manual route is kept and shown dotted with **Crosses a card**; use **Reset route** to drop it. Your routes are saved with the loop: they survive reloads, export and import, and publishing, and runs ignore them.

Check validation after every change. A node with problems shows an issue badge in its header: a cross when any of them is an error, a warning triangle when they are all warnings, and the count when there are several. Hover the badge, move to it with **Tab**, or click it to list each issue with its severity, message, and field; the list stays open while the pointer is over it or focus is inside it, a click keeps it open, and **Esc** closes it. Choose an issue to open the node's dialog with that field focused; an issue without a field opens the dialog at its top. The same badge sits beside the dialog's title while you edit. Beside **Publish**, the toolbar shows the loop's error and warning counts; click them for the issues that belong to the whole loop or to an edge, then a row per node with issues, which opens that node. With nothing to list it shows **Ready to publish** once the server has checked the saved draft (cron expressions, subloop references), **Checking…** until then, and **Validation unavailable** when the server could not be asked (offline, say); **Publish** runs the checks again either way. Text that does not parse in a JSON field is an issue too, with **Discard the unparsed text** in its row. An incomplete cron schedule uses **Discard the incomplete schedule**; both actions clear the held input and can be undone.

Fix errors before publishing: missing trigger or exit, unconnected or doubly connected ports, duplicate IDs, invalid targets or ports, unreachable nodes, a trigger with no path to an exit, undeclared variables, and inconsistent loop-backs. Warnings, such as an exit criterion above the loop's iteration ceiling, do not block publishing. The server repeats these checks when you publish, adds cron expression and timezone checks (they show on the trigger's badge once the draft has saved), and rejects errors with HTTP 422 `LOOP_INVALID`.

## Set workspace and limits

| Setting             | Configure it                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxIterations`     | Default 10, range 1 to 10,000. It limits exit loop-backs (the run ends `exhausted`) and fresh visits per node (the run fails `MAX_ITERATIONS`).                                                                |
| `workingDirectory`  | `temp` (default), `fixed` with `path`, or `template` with a Liquid `template`. The filesystem adapter creates the resolved directory if needed.                                                                |
| `subloopDepthLimit` | Default 8, range 1 to 64. A subloop node can replace it with `depthLimitOverride`.                                                                                                                             |
| `defaults`          | Set optional model and effort under `byHarness.codex` or `byHarness.claude`. Node values override that harness's loop defaults, then owner and API-process defaults. Harness is chosen on each inference node. |

For a repository workspace, use an absolute path. For a temporary workspace, use:

```json
{
  "workingDirectory": { "kind": "temp" },
  "defaults": { "byHarness": { "codex": { "model": "gpt-6-luna", "effort": "low" } } },
  "maxIterations": 3,
  "subloopDepthLimit": 8
}
```

Declare variable names and JSON Schemas in **Variables**; initialise their values with a mutation or mapping.

Empty or whitespace-only optional JSONata expressions count as absent and show no preview. Required blank expressions show the schema's error, with **Required** as a fallback, and omit the preview; the editor retains the typed whitespace. Liquid templates preserve their text exactly, including whitespace and required empty strings (for example, an empty script argument or a single-space delimiter). Only exactly empty optional template input means absent in the form. Imports and API clients that supply blank expressions receive a validation error before publishing; omit optional expressions instead. Supplied empty and whitespace-only templates remain valid.

The forms draw each field by its type. An asterisk (*) marks a field you must fill (screen readers hear "required"), and a list or set of options that needs entries says how many ("At least 2 items.", "Choose at least 1."); a problem shows under its field; a field with a default shows it as a placeholder or as the initial choice. An on/off setting with a default is a switch; one that may stay unset offers **Not set**, **Yes**, and **No**. A choice of two to four options is a row of segments (Tab reaches the chosen one and the arrow keys move it), a longer one a dropdown, and an optional choice keeps **Not set**. Liquid, JSONata, and JSON fields are code editors tagged with their language; **Tab** and **Shift+Tab** leave them as from any other field.

Inference, decision, script and subloop forms keep optional controls under **Advanced**, grouped by purpose. In inference, find model/effort overrides under **Advanced ? Model**; harness, session policy/key, prompt and sandbox stay visible on **Settings**. Open **Context** for `input` mutations, and **Context ? Advanced ? Files** for `contextFiles`. In provider decisions, **Context** holds message selection and last output; **Context ? Advanced ? Provider context** holds variable selection. Expression decisions have no Context tab. Decision answers/routes and required evaluator inputs stay visible on Settings; classifier confidence and Noul thresholds are under **Advanced ? Acceptance** inside Evaluation, with alternative recording under the form's **Advanced ? Recording**. Shared exit evaluators use the same nested threshold placement on their single panel.

Use Left/Right, Home and End on the tabs; Tab leaves the tablist for the selected panel. Both panels keep your edits and unparsed text when switching. Tabs and Advanced show problem counts, and choosing an issue opens the right tab and group at its field. Undo/Redo preserve your current tab and open groups; reopening starts on Settings. On large screens the node editor grows at 1024 and 1280 px; below 768 px it remains a full-width bottom sheet.

**Advanced** opens with Enter or Space and says how many options have values or problems. A mutate node's operations (and inference input/output transforms) are collapsed to one line each, their kind and path, with any problem flagged; an added operation opens ready to fill in. Each option's help comes from the [node reference](../reference/nodes.md).

**Add** moves focus to the new collection item's first control; **Remove** returns focus to that collection's Add button. Each action is announced. Removing a row drops its unparsed JSON and validation issue, while surviving text follows its own row. Renaming a record key keeps unparsed text and moves its issue to the new key. A key that already exists shows an inline error and keeps your typed key for correction, while both saved values remain intact.

## Publish, import, and export

Click **Publish** to save the draft and freeze a numbered version. Runs pin a version; later edits and publications do not change runs already started. Publishing also arms automatic triggers for the new version. The editor shows the current published version; the API exposes version history:

```http
GET /loops/{id}/versions
GET /loops/{id}/versions/{versionId}
```

Use **Export** on the Loops page to download JSON. It exports the published definition when one exists, otherwise the draft. To export unpublished changes explicitly, request:

```http
GET /loops/{id}/export?draft=true
```

Each Loops row groups **Edit**, **Export**, and **Delete** as buttons; Edit opens the editor. Export shows **Exporting…** while pending, keeps keyboard focus, and accepts one request at a time. Delete opens a confirmation naming the loop: the loop, all its versions and its triggers are removed, and loops using it as a subloop can no longer start it. This cannot be undone. Choose **Keep** or press Escape to cancel while idle, or **Confirm delete** to remove it. A 409 `LOOP_IN_USE` keeps the API's reason visible in the confirmation until you dismiss it or retry. Confirmation and Keep are disabled while the request is pending; repeated Escape presses cannot dismiss it.

Use the Loops page's file picker, or `POST /loops/import`, to import an export envelope or a bare definition. Import always creates a new loop with a draft, even if the name matches an existing loop. To update an existing loop, save its draft through the editor or API:

```http
PUT /loops/{id}/draft
```

The body wraps your definition:

```json
{
  "definition": {
    "schemaVersion": 2,
    "name": "starter",
    "nodes": [
      { "id": "start", "kind": "trigger", "label": "Start", "config": { "subtype": "manual" } },
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

## Import a complete first loop

Save this bare definition as a JSON file and import it. It follows the contracts' minimal trigger-to-exit fixture with an inference node inserted, and uses the fields and defaults of `LoopDefinitionSchema`. Publish it, select **Open in Runs**, and supply a topic. Replace the model if your Codex account uses another ID.

```json
{
  "schemaVersion": 2,
  "name": "first-summary",
  "description": "Ask Codex for a short explanation of a topic.",
  "settings": {
    "workingDirectory": { "kind": "temp" },
    "defaults": { "byHarness": { "codex": { "model": "gpt-6-luna", "effort": "low" } } },
    "maxIterations": 3,
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
        "subtype": "manual",
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
        "criteria": [],
        "default": "success",
        "return": {
          "mapping": "{ \"summary\": lastOutput.value }",
          "channels": [{ "kind": "caller" }]
        }
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

## Match an exit answer

Decision and exit **Answer type** cards keep their labels short. Tab reaches the chosen answer once; use the arrow keys to change it. Keyboard focus on a radio shows its explanation without moving focus, and leaving the option or pressing Escape closes it. Clicking or tapping a card selects it without opening help. Hover or tap the help button beside Choice, Noul or Score to read the same explanation; these buttons are outside the Tab order. Tap again to close pinned help without changing the answer. Screen readers can read each option's explanation even while the help is closed.

An exit criterion can evaluate a Noul, Choice or Score answer and compare it with an explicit rule. Choose true or false for Noul, one or more declared IDs for Choice, or a rubric-index comparison for Score. Provider Noul also needs criteria for each side. Score preserves fractional values; exits do not need routing bands.

Choose a classifier that supports the answer type, or Codex LLM for Noul/Choice. Expressions produce strict boolean Noul. A classifier confidence minimum and the optional LLM self-reported confidence minimum can reject an answer before matching. A rejected answer never matches, even if the rule asks for false. Inspect the raw answer, gate and rule separately in the run timeline.

Criteria run from top to bottom. A match on the final permitted iteration still completes; if none matches, the default either succeeds or takes the single loop-back, subject to the iteration ceiling. Keep explicit duration/iteration criteria in the intended order. Existing question context is unchanged; no new session controls are required.
