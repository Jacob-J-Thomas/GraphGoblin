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
  "schemaVersion": 1,
  "name": "review-until-green",
  "description": "One sentence on what the loop does.",
  "settings": { "maxIterations": 5, "defaults": { "model": "gpt-6-luna", "effort": "low" } },
  "variables": { "topic": { "type": "string" } },
  "nodes": [
    { "id": "start", "kind": "trigger", "label": "Start", "config": { "subtype": "manual" } },
    { "id": "done", "kind": "exit", "label": "Done", "config": {} }
  ],
  "edges": [{ "id": "e1", "from": { "node": "start", "port": "out" }, "to": { "node": "done" } }]
}
```

Rules: node and edge ids are lowercase slugs and unique; every node has a `label`; an edge goes from a node's output port to another node (the target port is always `in`). Most nodes have one output port `out`; decision nodes have one port per route label; script nodes may add ports through `exitCodeRoutes`; exit nodes only have `loopBack` when configured. There are no error ports: failures are handled by the engine. Templates use Liquid over the context thread (for example `{{ vars.topic }}`, `{{ lastOutput.value }}`); expressions use JSONata.

### Node catalog (the nine kinds)

Decision strategy `jev` optionally selects a classifier catalog id with `jev.model`; omission means the built-in `jev`. The `jev` block also supports `primitive: "choice"` and `minConfidence`. Inspect `/classifier-models` through REST when choosing an enabled entry supporting Choice; no classifier MCP tool is added. Explicit selections never substitute the built-in. Unknown ids or entries without Choice block publication. Disabled entries and missing/blank or unreadable required secrets warn that this strategy will be skipped; configure the model in Settings and its secret in Settings, Secrets, or add a later strategy. Low confidence also tries the next strategy. Exit predicates retain the built-in Jev Noul path and have no model selector.

Select the harness on each inference node with `config.harness` (default `codex`, the only
supported harness). Loop `settings.defaults` contains only optional model and effort.
Do not put a harness in loop defaults. Model and effort inherit from loop and owner defaults
when omitted on the node; decision strategies and structured repair keep their own Codex ports.

| Kind        | Purpose                                          | Key config                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trigger`   | Starts a run; a loop may have several            | `subtype`: `manual` (`inputSchema?`, `exposeTo` of `ui`/`api`/`mcp`), `cron` (`expression`, `timezone`, `missedFirePolicy`), `webhook` (`signature.secretRef`, `filter?`), `event` (`eventType`, `filter?`), `poll` (stretch)  |
| `decision`  | Chooses one of several labelled routes           | `routes` (at least two `{ label, description }`), `question` template, `strategy` ordered from `jev`, `codex`, `expression` (`expression.jsonata` must return a route label), `context`                                        |
| `inference` | Hands work to the Codex harness                  | `prompt.template` (required), `model?`, `effort?`, `session.policy` (`fresh`, `resume-previous`, `resume-named` with `key`), `harnessOptions.sandbox`, `output.schema.jsonSchema` for structured output, `timeoutSeconds?`     |
| `script`    | Runs a command                                   | `command`, `args` templates, `cwd`, `stdin` (`thread`, `last-output`, `none`), `stdout` (`patch`, `last-output`, `ignore`), `exitCodeRoutes` (exit code to route label)                                                        |
| `mutate`    | Edits the context thread without an LLM          | `operations` (at least one): `set`, `delete`, `append-message`, `inject`, `truncate`, `drop`, `replace`, `redact`, `coerce`                                                                                                    |
| `subloop`   | Runs another loop as a child                     | `loopRef.loopId`, `loopRef.version` (`latest` or a number), `input` mapping (`mode`: `inherit`, `project`, `fresh`), `output` mapping (`mode`: `result-only`, `merge`, `custom`)                                               |
| `wait`      | Parks the run                                    | `mode`: `input` (`prompt`, `inputSchema?`), `duration` (`seconds`), `until` (`timestamp`), `signal` (`name`); `timeoutSeconds?`, `onTimeout` (`continue`, `fail-run`)                                                          |
| `heartbeat` | Repeats a probe on an interval until a condition | `intervalSeconds`, `probe` (`http`, `script`, `signal-count`, `none`), and at least one of `until` (JSONata), `maxBeats`, `deadline`                                                                                           |
| `exit`      | Ends the run or loops back                       | `criteria` (`max-iterations`, `max-duration`, `predicate`, `last-output-matches`), `default` (`success` or `loop-back` with `loopBack.targetNodeId`), `return.mapping` (JSONata or `none`), `return.channels` (default caller) |

Prefer the smallest graph that does the job. Give every loop that can go around again an exit criterion or rely on `settings.maxIterations`.

## 3. Validate and save as a draft

The MCP tools cover runs, not editing, so use the REST API with the same settings as the MCP server: base URL `GG_API_URL` (default `http://127.0.0.1:4747`) and, when `GG_API_KEY` is set, the header `Authorization: Bearer <key>`. Write the definition to a temporary JSON file and send it with `curl` or PowerShell `Invoke-RestMethod`.

1. **New loop**: `POST /loops` with body `{ "definition": <definition> }`. The response is `{ loop, draft, issues }`; the loop now exists with your draft. **Changing an existing loop**: `PUT /loops/{id}/draft` with the same body returns `{ draft, issues }`.
2. **Check without saving**: `POST /loops/{id}/validate` with `{ "definition": <definition> }` returns `{ issues, publishable }`.
3. Read `issues`. Each has `severity` (`error` or `warning`), `code`, `message`, and `nodeId` or `edgeId`. Fix every `error` and save the draft again; explain any `warning` you leave. A `400 VALIDATION_FAILED` response means the JSON does not match the schema; its `errors[].path` points at the field.
4. Stop when `issues` has no errors. Report the loop id, a short description of the graph (nodes in order and how they route), and the remaining warnings.

## 4. Publishing

Only when the user explicitly asks: `POST /loops/{id}/publish`. Then they can run it with `$run-loop`. To try an unpublished draft, `$run-loop` can start it with `allowDraft: true` after the user agrees.
