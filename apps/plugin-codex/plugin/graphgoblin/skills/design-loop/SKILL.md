---
name: design-loop
description: Draft a GraphGoblin loop definition from a plain-language description, validate it against the API, and save it as a draft. Use when the user asks to create, design, sketch, or change a GraphGoblin loop or workflow. Never publishes unless the user explicitly asks.
---

# Design a GraphGoblin loop

A loop is a graph of nodes joined by edges. You write its definition as JSON, check it with the API, and save it as a **draft**. Do not publish it unless the user explicitly asks you to; publishing freezes a version that triggers and other loops will run.

## 1. Understand the request

Ask only what you cannot infer: how the loop starts (manual, schedule, webhook, event), what input it takes, what the agent work is, when it is done, and what it should return. Call `list_loops` to avoid duplicating an existing loop and to find loop ids for subloops.

## 2. Draft the definition

```json
{
  "schemaVersion": 4,
  "name": "review-until-green",
  "description": "One sentence on what the loop does.",
  "settings": {
    "maxIterations": 5,
    "defaults": { "byHarness": { "codex": { "model": "gpt-6-luna", "effort": "low" } } }
  },
  "variables": { "topic": { "type": "string" } },
  "nodes": [
    { "id": "start", "kind": "trigger", "label": "Start", "config": { "subtype": "manual" } },
    { "id": "done", "kind": "exit", "label": "Done", "config": {} }
  ],
  "edges": [{ "id": "e1", "from": { "node": "start", "port": "out" }, "to": { "node": "done" } }]
}
```

Rules: node and edge ids are bounded slugs and unique; every node has a `label`; an edge goes from a node's output port to another node (the target port is always `in`). Most nodes have one output port `out`; expression/LLM decisions use their declared `routes[].id`; classifier Choice uses option IDs, Noul uses the authored `true.id` and `false.id` ports, and Score uses the authored `bands[].id` ports; script nodes may add ports through `exitCodeRoutes`; exit nodes only have `loopBack` when configured. There are no error ports: failures are handled by the engine. Templates use Liquid over the context thread (for example `{{ vars.topic }}`, `{{ lastOutput.value }}`); expressions use JSONata.

### Node catalog (the nine kinds)

Decision configuration is a strict union on `kind`:

- `expression`: `jsonata` and `routes: [{id,label}, ...]`. The single snippet must return a declared scalar string ID. A plain check becomes `vars.done ? "done" : "retry"`, with both routes declared. Non-string, missing or undeclared results fail; nothing is coerced.
- `llm`: freeform Liquid `instructions`, readable `routes`, `harness: "codex"`, required `model` and `effort` selections (`{mode:"inherit"}` or `{mode:"explicit",value:...}`), plus optional provider `context`. Describe routing guidance in the instructions. Codex returns exactly `route`, `confidence` and `reasoning`; route must be declared. Confidence is finite in [0,1] and informational only, with no gate. Reasoning is stored as an excerpt of at most 2,048 characters. No repair or fallback occurs.
- `classifier`: explicit catalog `model`, Liquid `question`, `answer`, optional `context`, optional `minConfidence`, Noul-only optional `truthThreshold`, and optional `recordAlternatives`. Only classifiers use `answer.type`: Choice options have `{id,label,criteria}`; Noul has authored true/false sides with IDs, labels and criteria; Score has ordered anchors and contiguous bands with stable IDs. Noul probability equality at the truth threshold selects true; its chosen-side confidence is checked separately. Score preserves fractional indices without rounding. Select an enabled classifier supporting the requested primitive from `/classifier-models`.

Expression/LLM routes contain only IDs and labels: 2-64 declarations, unique bounded slug IDs excluding `in`, and unique trimmed nonblank labels of at most 120 characters. Do not add classifier answer blocks, criteria or recordAlternatives to these branches. Nested `evaluation` and inactive settings are rejected.

```json
{
  "kind": "expression",
  "jsonata": "vars.done ? \"done\" : \"retry\"",
  "routes": [
    { "id": "done", "label": "Done" },
    { "id": "retry", "label": "Try again" }
  ]
}
```

Decision outputs are `{portId,provenance,observation}`. Read `lastOutput.value.observation.routeId` for an expression/LLM route and `lastOutput.value.observation.answer` for classifier evidence. `decision.made` has at most three factual diagnostics; fresh decisions have none. Questions/instructions still render against the full thread; provider context selectors do not restrict Liquid exposure.

Exit predicates temporarily use `{when:"predicate",predicate,match,outcome}`. Expressions and Codex return booleans with `match:{type:"boolean",value:true}`; Codex uses Liquid `instructions`. Classifiers declare their primitive under `predicate.answer`, with Choice `match.optionIds`, Noul `match.value`, or Score `match.operator`/`value`. Classifier confidence and existing exit-only `match.minReportedConfidence` rejection remain nonmatches. Errors fail evaluation. Preserve existing criterion order, returns and loop-back; do not introduce a Continue node or the later decision-gate exit design.

Current definitions/exports use format 4. Old exports and format-3 stores require the integrated cutover, which is not supplied by D1.

Unavailable classifiers block publication at `config.model` (or `config.criteria.<index>.predicate.model` for exits). Registering an HTTP classifier with `secretRef` needs both `settings:write` and `secrets:write`; authenticated remote endpoints require HTTPS. Select `config.harness` on inference nodes (`codex` or installed `claude`); supported model/effort selections come from the live catalog and harness preflight. Claude currently uses the installed CLI's Claude.ai account, with installed-CLI, login and exact model checks. Loop `settings.defaults.byHarness` holds optional model and effort per harness; it does not choose the node's harness. Model and effort inherit within that harness when omitted. Decision/exit LLM evaluation and structured repair currently use their Codex ports.

| Kind        | Purpose                                          | Key config                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trigger`   | Starts a run; a loop may have several            | `subtype`: `manual` (`inputSchema?`, `exposeTo` of `ui`/`api`/`mcp`), `cron` (`expression`, `timezone`, `missedFirePolicy`), `webhook` (`signature.secretRef`, `filter?`), `event` (`eventType`, `filter?`), `poll` (single or bounded items) |
| `decision`  | Chooses one declared route                       | `kind` with expression, LLM or classifier fields; see above                                                                                                                                                                                   |
| `inference` | Hands work to the selected harness               | `prompt.template` (required), `model?`, `effort?`, `session.policy` (`fresh`, `resume-previous`, `resume-named` with `key`), `harnessOptions.sandbox`, `output.schema.jsonSchema` for structured output, `timeoutSeconds?`                    |
| `script`    | Runs a command                                   | `command`, `args` templates, `cwd`, `stdin` (`thread`, `last-output`, `none`), `stdout` (`patch`, `last-output`, `ignore`), `exitCodeRoutes` (exit code to route label)                                                                       |
| `mutate`    | Edits the context thread without an LLM          | `operations` (at least one): `set`, `delete`, `append-message`, `inject`, `truncate`, `drop`, `replace`, `redact`, `coerce`                                                                                                                   |
| `subloop`   | Runs another loop as a child                     | `loopRef.loopId`, `loopRef.version` (`latest` or a number), `input` mapping (`mode`: `inherit`, `project`, `fresh`), `output` mapping (`mode`: `result-only`, `merge`, `custom`)                                                              |
| `wait`      | Parks the run                                    | `mode`: `input` (`prompt`, `inputSchema?`), `duration` (`seconds`), `until` (`timestamp`), `signal` (`name`); `timeoutSeconds?`, `onTimeout` (`continue`, `fail-run`)                                                                         |
| `heartbeat` | Repeats a probe on an interval until a condition | `intervalSeconds`, `probe` (`http`, `script`, `signal-count`, `none`), and at least one of `until` (JSONata), `maxBeats`, `deadline`                                                                                                          |
| `exit`      | Ends the run or loops back                       | `criteria` (`max-iterations`, `max-duration`, `predicate`, `last-output-matches`), `default` (`success` or `loop-back` with `loopBack.targetNodeId`), `return.mapping` (JSONata or `none`), `return.channels` (default caller)                |

Prefer the smallest graph that does the job. Give every loop that can go around again an exit criterion or rely on `settings.maxIterations`.

## 3. Validate and save as a draft

The MCP tools cover runs, not editing, so use the REST API with the same settings as the MCP server: base URL `GG_API_URL` (default `http://127.0.0.1:4747`) and, when `GG_API_KEY` is set, the header `Authorization: Bearer <key>`. Write the definition to a temporary JSON file and send it with `curl` or PowerShell `Invoke-RestMethod`.

1. **New loop**: `POST /loops` with body `{ "definition": <definition> }`. The response is `{ loop, draft, issues }`; the loop now exists with your draft. **Changing an existing loop**: `PUT /loops/{id}/draft` with the same body returns `{ draft, issues }`.
2. **Check without saving**: `POST /loops/{id}/validate` with `{ "definition": <definition> }` returns `{ issues, publishable }`.
3. Read `issues`. Each has `severity` (`error` or `warning`), `code`, `message`, and `nodeId` or `edgeId`. Fix every `error` and save the draft again; explain any `warning` you leave. A `400 VALIDATION_FAILED` response means the JSON does not match the schema; its `errors[].path` points at the field.
4. Stop when `issues` has no errors. Report the loop id, a short description of the graph (nodes in order and how they route), and the remaining warnings.

## 4. Publishing

Only when the user explicitly asks: `POST /loops/{id}/publish`. Then they can run it with `$run-loop`. To try an unpublished draft, `$run-loop` can start it with `allowDraft: true` after the user agrees.
