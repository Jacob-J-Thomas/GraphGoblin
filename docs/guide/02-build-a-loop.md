# Build a loop

## Edit the starter graph

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on the starter graph. Click **Edit** to open an existing loop.
2. Drag a node from the left palette onto the canvas, or click its palette button to add it. The new node is selected.
3. Click a node to edit it, or move to it with **Tab** and press **Enter**. Its editor opens in a dialog named **Edit _kind_ _id_**: set its ID, label, and config. IDs start with a letter and contain letters, digits, underscores, or hyphens; keep them unique. Dragging a node moves it without opening the dialog.
4. Remove the starter edge before inserting your own path. Use **Connections** in the node's dialog to remove an edge, or select the edge on the canvas and press **Delete** or **Backspace**.
5. Drag from a labelled output handle to the next node's input handle, or use the dialog's **Connect** form, which is the keyboard path: pick one of the node's free outputs and a target. **Delete node** in the dialog removes the node and its edges.
6. Use the **Loop** panel on the right for the loop's name, description, workspace, defaults, limits, and declared variables.

Edits in the dialog save as you type, so closing it never discards anything: use **Done**, the close button, **Esc**, or a click outside it, and focus returns to the node. An ID you are still typing applies when the dialog closes; an ID that cannot apply keeps the dialog open once with the reason, and closing again keeps the old ID. **Delete** and **Backspace** inside the dialog only edit text. While the dialog is open the rest of the editor waits, so close it to reach **Publish** or the palette. Below 768 px wide the dialog is a sheet along the bottom of the window.

**Loop settings** in the toolbar shows or hides the loop panel, as does the panel's own button. The browser remembers the choice; until you choose, the panel starts expanded on windows at least 1280 px wide and collapsed below. Collapsed, it keeps a narrow rail with its show button. Validation stays in sight either way, on the nodes and beside **Publish** (see [Connect and validate](#connect-and-validate)).

The editor lives at this browser route:

```text
/app/loops/<loop-id>/edit
```

Edits autosave after a short debounce and are mirrored in IndexedDB. A schema-invalid draft stays on the device with **Saved on this device only**; fix it before relying on the server copy. Offline saves retry on reconnect. An unsynced local draft takes precedence on reload, unless the server saved a newer draft since; then the server copy is shown and the device copy is offered with **Use this device's copy instead**.

Every save tells the server which copy the edit started from. If another tab, device, or API client saved the draft in between, nothing is overwritten: **The draft changed on the server** appears (inside the node dialog too, when one is open), autosave stops, and you choose **Reload server draft** (take theirs, dropping this editor's unsaved changes and closing the dialog) or **Overwrite with this copy** (keep yours). Until you choose, edits stay on this device and **Publish** refuses. API clients get the same protection by sending `If-Match` with the `draftToken` from `GET /loops/{id}` (see [API, streaming, and MCP](../07-api-and-streaming.md#draft-conflicts-decided-wp-f2-adr-0015)).

## Choose nodes

**Trigger (`trigger`).** Choose `subtype`: `manual`, `cron`, `webhook`, `event`, or `poll`. For manual starts, set `inputSchema` to validate input and `exposeTo` to declare intended `ui`, `api`, and `mcp` surfaces. The trigger records its payload as an output and follows `out`. Configure automatic sources in [Triggers](04-triggers.md).

> After 1.0: Surface-aware start and input controls. Today `exposeTo` is recorded and described to MCP callers, but the web launcher and engine commands do not enforce it. Use API authentication for access control.

**Decision (`decision`).** Define at least two `routes`, each with a unique `label` and `description`; route labels cannot be `in`. Set a Liquid `question` and ordered `strategy` list using `jev`, `codex`, or `expression`. An expression strategy needs `expression.jsonata` returning a route label. Limit context with `context.messages`, `context.vars`, and `context.includeLastOutput`; declare selected variables in loop settings. Set `jev.minConfidence` or `codex.model` and `codex.effort` when needed. An unavailable decider, an unknown label, or a Jev answer below `minConfidence` falls through to the next strategy. When every strategy falls through, the run fails with `DECISION_NO_ROUTE`; an error raised by a decider fails the run at once. The chosen route is recorded as the node's output. Connect every route.

**Inference (`inference`).** Set `prompt.template` for a Codex turn. Choose `model`, `effort`, and `session.policy`: `fresh`, `resume-previous`, or `resume-named` with a `key`. Set `harnessOptions.sandbox` to `read-only`, `workspace-write` (default), or `danger-full-access`; `approval` defaults to `never`, while network and web search are off unless enabled. Use `input` transformations, `contextFiles`, and `output.transforms` to shape context. Set `output.schema.jsonSchema` for structured output and configure its `repair` policy. `output.captureTranscript` defaults to `artifact`, `output.toMessages` to `final`; `timeoutSeconds` is optional. The output goes to `lastOutput.value` and the node follows `out`.

> After 1.0: Resolution of inference `capabilities.mcpServers`, `capabilities.plugins`, and `capabilities.skills` profiles. The current Codex adapter ignores these names; use explicit `harnessOptions.configOverrides` for Codex configuration today.

**Script (`script`).** Set an executable `command`, templated `args`, `cwd` (default `workspace`), and optional `env` and `timeoutSeconds`. Commands execute as the API's operating-system user, without a shell wrapper; invoke a shell explicitly if your program needs one. `stdin` accepts `thread`, `last-output`, or `none`; `stdout` accepts `last-output`, `patch` (RFC 6902), or `ignore`. In `env`, use the secret-reference syntax in [Settings and secrets](06-settings-and-secrets.md#store-secrets). Map expected nonzero codes through `exitCodeRoutes`; an unmapped nonzero code fails the run. Connect `out` and every additional route. Make scripts safe to execute again after interruption.

**Mutate (`mutate`).** Add at least one item to `operations`. Use `set` or `delete` with a JSON Pointer, `append-message`, `inject`, `truncate`, `drop`, `replace`, `redact`, or `coerce`. A `set.value` uses a `kind` of `literal`, `template`, or `expression`; each has its corresponding value, template, or JSONata field. Selection and replacement operations have their own `target` and filter fields. `coerce` validates a source value against `jsonSchema` and can request a Codex repair turn. Ordinary mutations modify context directly and follow `out`.

**Subloop (`subloop`).** Pick a published loop, then set `loopRef.loopId` and `loopRef.version` to `latest` or a published version number. Choose `input.mode`: `inherit`, `project`, or `fresh`; use exclusions, variable expressions, message/artifact selections, injected messages, and `input.trigger.payload` as needed. Choose `output.mode`: `result-only`, `merge`, or `custom`; configure `resultTo`, merge rules, or a custom patch expression. `output.usage` defaults to `roll-up`. The parent waits for the child, then follows `out`; `depthLimitOverride` can replace the loop's depth limit at this node.

**Wait (`wait`).** Choose `mode`: `input` with a Liquid `prompt` and optional `inputSchema`; `duration` with `seconds`; `until` with a Liquid `timestamp` that renders to a date; or `signal` with a `name` and optional JSONata `filter`. Input mode also declares `exposeTo`. Set optional `timeoutSeconds` and `onTimeout`: `continue` (default) or `fail-run`. Input and signal values become messages and the last output; a continuing timeout produces an object with `timedOut` true. The node parks, releases its worker, and follows `out` when it wakes.

**Heartbeat (`heartbeat`).** Set `intervalSeconds` and a `probe` of `http`, `script`, `signal-count`, or `none`. Supply at least one of `until` (JSONata), `maxBeats`, or `deadline` (Liquid timestamp). HTTP probes have method, URL, headers, body, and timeout fields; script probes have command, args, and timeout fields. The condition sees `probe`, `thread`, `beat`, and `now`. The first probe executes on entry; later beats park on timers. Choose `record` of `summary` or `full`, and `onExhausted` of `continue` or `fail-run`; completion follows `out`.

**Exit (`exit`).** Evaluate `criteria` in order using `max-iterations`, `max-duration`, `predicate`, or `last-output-matches`. Choose `default` of `success` or `loop-back`; the latter needs `loopBack.targetNodeId` and a matching edge. Set `return.mapping` to a JSONata expression and choose `return.channels`; `none` omits the payload. A terminal exit has no output port; a configured loop-back exposes `loopBack`. The loop's iteration ceiling is checked when the exit evaluates, so route repeated work through an exit to bound it.

## Connect and validate

Connect exactly one edge per output port. Multiple inputs may converge on a node, but each run follows one route at a time. Triggers have no input. Ordinary output ports are `out`, decision ports are route labels, script ports include exit-code labels, and exit ports are limited to `loopBack`. Edge targets use `in`.

For a loop-back, connect the exit handle to a working node, such as inference or mutation. The canvas sets `loopBack.targetNodeId` for you; it cannot target a trigger or another exit. Only this exit transition increments the iteration. A cycle through other nodes does not consume the iteration limit.

Check validation after every change. A node with problems shows an issue badge in its header: a cross when any of them is an error, a warning triangle when they are all warnings, and the count when there are several. Hover the badge, move to it with **Tab**, or click it to list each issue with its severity, message, and field; the list stays open while the pointer is over it, and **Esc** closes it. Choose an issue to open the node's dialog with that field focused; an issue without a field opens the dialog at its top. The same badge sits beside the dialog's title while you edit. Beside **Publish**, the toolbar shows **Ready to publish**, or the loop's error and warning counts; click them for the issues that belong to the whole loop or to an edge, then a row per node with issues, which opens that node. Text that does not parse in a JSON field is an issue too, with **Discard text** in its row.

Fix errors before publishing: missing trigger or exit, unconnected or doubly connected ports, duplicate IDs, invalid targets or ports, unreachable nodes, a trigger with no path to an exit, undeclared variables, and inconsistent loop-backs. Warnings, such as an exit criterion above the loop's iteration ceiling, do not block publishing. The server repeats these checks when you publish, adds cron expression and timezone checks (they show on the trigger's badge once the draft has saved), and rejects errors with HTTP 422 `LOOP_INVALID`.

## Set workspace and limits

| Setting             | Configure it                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxIterations`     | Default 10, range 1 to 10,000. It limits exit loop-backs (the run ends `exhausted`) and fresh visits per node (the run fails `MAX_ITERATIONS`). |
| `workingDirectory`  | `temp` (default), `fixed` with `path`, or `template` with a Liquid `template`. The filesystem adapter creates the resolved directory if needed. |
| `subloopDepthLimit` | Default 8, range 1 to 64. A subloop node can replace it with `depthLimitOverride`.                                                              |
| `defaults`          | Set the Codex `harness`, optional `model`, and optional `effort`. Node values override loop defaults, which override API-process defaults.      |

For a repository workspace, use an absolute path. For a temporary workspace, use:

```json
{
  "workingDirectory": { "kind": "temp" },
  "defaults": { "harness": "codex", "model": "gpt-6-luna", "effort": "low" },
  "maxIterations": 3,
  "subloopDepthLimit": 8
}
```

Declare variable names and JSON Schemas in **Variables**; initialise their values with a mutation or mapping.

Empty optional expressions count as absent and show no preview. Whitespace counts as supplied.

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
    "schemaVersion": 1,
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
  "schemaVersion": 1,
  "name": "first-summary",
  "description": "Ask Codex for a short explanation of a topic.",
  "settings": {
    "workingDirectory": { "kind": "temp" },
    "defaults": { "harness": "codex", "model": "gpt-6-luna", "effort": "low" },
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
