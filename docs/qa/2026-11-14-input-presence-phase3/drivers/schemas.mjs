// Schemas shared by the phase 3 drivers (in addition to common.mjs's VISUAL_SCHEMA).
export const LONG_TITLE =
  'Reviewer explanation of why this run should continue past the approval gate after the second check';
export const LONG_JSON_TITLE =
  'Structured reviewer notes attached to the approval record for later audit';
export const LONG_SCHEMA = {
  type: 'object',
  properties: {
    first: { type: 'string', title: 'First' },
    long: { type: 'string', title: LONG_TITLE },
    longJson: { type: 'object', title: LONG_JSON_TITLE, description: 'Any JSON object' },
  },
};
