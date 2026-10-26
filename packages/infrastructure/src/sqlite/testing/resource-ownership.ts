/** Historical fixtures rewind all of unshipped 0022 before replaying an older ledger suffix. */
export const RESOURCE_OWNERSHIP_REWIND_SQL = [
  'DROP TRIGGER workspace_version_insert',
  'DROP TRIGGER workspace_version_change',
  'DROP TRIGGER workspace_version_delete',
  'DROP TRIGGER workspace_use_insert',
  'DROP TRIGGER workspace_use_delete',
  'DROP TRIGGER workspace_run_insert',
  'DROP TRIGGER workspace_run_version',
  'DROP TRIGGER workspace_run_delete',
  'DROP TABLE workspace_references',
  'DROP TABLE workspace_reference_state',
  'DROP TABLE run_resource_uses',
  'DROP TABLE run_resources',
] as const;
