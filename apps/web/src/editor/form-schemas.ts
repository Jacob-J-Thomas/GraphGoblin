import { fieldMeta, NodeConfigSchemas } from '@graphgoblin/contracts';

// Reuse the harness field shape and its control metadata for the Codex decider's form.
// The decision contract stays untouched; Jev keeps its separate classifier control.
const codex = NodeConfigSchemas.decision.shape.codex;
export const NODE_FORM_SCHEMAS = {
  ...NodeConfigSchemas,
  decision: NodeConfigSchemas.decision.safeExtend({
    codex: codex
      .unwrap()
      .extend({
        model: NodeConfigSchemas.inference.shape.model,
        effort: NodeConfigSchemas.inference.shape.effort,
      })
      .optional()
      .meta(fieldMeta(codex)),
  }),
};
