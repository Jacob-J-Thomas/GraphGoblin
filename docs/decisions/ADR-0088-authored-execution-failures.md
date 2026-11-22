# ADR-0088 - Authored failures at execution boundaries

Status: Selected under delegated coordinator decision D188. Consolidated owner decision review is pending.

## Context

A loop pins its definition for the run. An internal-error message gave an author little way to find a failing template or expression, and Resume could repeat a probe, context-file write or provider action before encountering the same field again. The evaluator also serves callers that can supply JavaScript bindings. A library exception and one thrown by a binding can have identical messages, codes and object identities. [Issue and plan](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061825658)

## Decision

Project errors at the selected concrete evaluation sites on pinned source and inert run data. A single JSONata evaluation produces a value or its original rejection plus a finite observation of the phase that failed. Parsing and regex safety describe the top-level source. A rejected runtime string in `$eval` receives the ordinary evaluation direction. Per-invocation hook identity establishes a winning depth or time limit. Binding preparation and predicate coercion carry no authored fact.

Use a fixed field, a bounded cause and corrective action in the existing error codes. Report one-based ordinals for people and zero-based indices in details. Names, paths, runtime values and literal `$error` arguments are excluded from the new copy. At these newly typed JSONata sites the evaluator's own message is neither published nor logged. Existing Mutate and Exit failures can expose bounded authored text, including an expression's message. That historical policy differs from the fixed inference-transform and subloop messages selected here. Decision-route evaluation and request-side signal rejection retain their established projections.

A deterministic fault in a pinned field refuses Resume. Workspace templates render and trim in the engine before the filesystem port resolves a fixed or temporary directory. A failed terminal file return uses the existing channel receipt. A parent mapping failure keeps the real terminal child completion. Child-failure links belong to an actual failed child.

Preparation can preserve previous task evidence without recording a new intent. Only the winning repair-prompt or transform fault after a provider result reports that result in its public message and phase. Existing acceptance, uncertainty, cleanup, cancellation and timeout rules determine the last actual turn and the winning cause. Publication uses the existing failure row and event. Historical data remains readable with its original text and recovery state.

## Alternatives considered

Publishing a guarded literal would require an additional AST-shape contract and would help only a narrow form of an expression that always fails. A process-wide error marker or class/code mapper could misattribute a rethrown error from another call. Automatic retry would repeat work from earlier successful steps. The selected approach keeps diagnostics local to the operation and preserves observed effects.
