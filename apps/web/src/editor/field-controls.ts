import type { FieldControls } from '../forms/fields.js';
import { ClassifierField } from './ClassifierField.js';

/**
 * Controls that draw node config fields in place of the default renderer, by the name a field's
 * metadata gives in `control` (`.meta(field('…', { control: 'model' }))` in the contracts). The
 * node editor passes them to its config form. Registered: the decision's classifier picker under
 * `classifier` (#43). Still to come: the inference model picker (#16) under `model`, the cron
 * builder (#20).
 */
export const NODE_FIELD_CONTROLS: FieldControls = {
  classifier: ClassifierField,
};
