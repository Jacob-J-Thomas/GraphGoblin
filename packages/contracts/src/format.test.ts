import { expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  CONTRACTS_SCHEMA_VERSION,
  LoopDefinitionSchema,
  LoopExportSchema,
} from './index.js';

it('reads every current definition/export format literal from the single format constant', () => {
  expect(LoopDefinitionSchema.shape.schemaVersion.value).toBe(CURRENT_DEFINITION_FORMAT);
  expect(LoopExportSchema.shape.formatVersion.value).toBe(CURRENT_DEFINITION_FORMAT);
  expect(CONTRACTS_SCHEMA_VERSION).toBe(CURRENT_DEFINITION_FORMAT);
});
