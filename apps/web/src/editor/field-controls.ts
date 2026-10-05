import type { FieldControls } from '../forms/fields.js';
import { EffortField, LoopModelField, ModelField } from '../forms/fields/model.js';

/**
 * Controls that draw node config fields in place of the default renderer, by the name a field's
 * metadata gives in `control` (`.meta(field('…', { control: 'model' }))` in the contracts). The
 * node editor passes them to its config form. Other controls register here additively.
 */
export const NODE_FIELD_CONTROLS: FieldControls = { model: ModelField, effort: EffortField };

export const LOOP_FIELD_CONTROLS: FieldControls = { model: LoopModelField, effort: EffortField };
