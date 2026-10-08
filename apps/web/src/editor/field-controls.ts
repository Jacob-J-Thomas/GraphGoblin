import type { FieldControls } from '../forms/fields.js';
import { CronControl, CronTimezoneControl } from '../forms/cron/control.js';
import { EffortField, LoopModelField, ModelField } from '../forms/fields/model.js';
import { ClassifierField } from './ClassifierField.js';
import { ClaudeApprovalField, ClaudePolicyField } from './ClaudePolicyField.js';

/**
 * Controls that draw node config fields in place of the default renderer, by the name a field's
 * metadata gives in `control` (`.meta(field('…', { control: 'model' }))` in the contracts). The
 * node editor passes them to its config form. Registry entries: the catalog model and effort
 * pickers (#16), the cron schedule builder and its time zone picker (#20), and the decision's
 * classifier picker (#43). Other controls register additively.
 */
export const NODE_FIELD_CONTROLS: FieldControls = {
  model: ModelField,
  effort: EffortField,
  cron: CronControl,
  'cron-timezone': CronTimezoneControl,
  classifier: ClassifierField,
  'claude-policy': ClaudePolicyField,
  'claude-approval': ClaudeApprovalField,
};

export const LOOP_FIELD_CONTROLS: FieldControls = { model: LoopModelField, effort: EffortField };
