DROP INDEX template_issue_attempt_idx;
--> statement-breakpoint
DROP INDEX template_qa_merge_idx;
--> statement-breakpoint
DROP INDEX template_pr_head_idx;
--> statement-breakpoint
DROP INDEX template_active_pr_idx;
--> statement-breakpoint
DROP INDEX template_child_visit_idx;
--> statement-breakpoint
DROP INDEX template_qa_issue_attempt_idx;
--> statement-breakpoint
ALTER TABLE runs DROP COLUMN template_subject;
--> statement-breakpoint
DROP TABLE template_instances;
