export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** Node or edge id the issue is about, when applicable. */
  nodeId?: string;
  edgeId?: string;
  /**
   * The field the issue is about, when one is: relative to the node (`config.prompt.template`)
   * when `nodeId` is set, else to the definition (`settings.workingDirectory.template`).
   */
  path?: string;
}
