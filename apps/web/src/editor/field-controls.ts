import type { FieldControls } from '../forms/fields.js';
import { CronControl, CronTimezoneControl } from '../forms/cron/control.js';

/**
 * Controls that draw node config fields in place of the default renderer, by the name a field's
 * metadata gives in `control` (`.meta(field('…', { control: 'model' }))` in the contracts). The
 * node editor passes them to its config form. Registry entries include the inference
 * model picker (#16) under `model`, the decision's Jev model (#43), the cron builder (#20).
 */
export const NODE_FIELD_CONTROLS: FieldControls = {
  cron: CronControl,
  'cron-timezone': CronTimezoneControl,
};
