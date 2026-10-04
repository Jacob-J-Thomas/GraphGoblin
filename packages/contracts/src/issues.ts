import { z } from 'zod';

/** API validation issues use node-relative paths when nodeId is present. */
export const LoopIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  path: z.string().optional(),
});
export type LoopIssue = z.infer<typeof LoopIssueSchema>;
