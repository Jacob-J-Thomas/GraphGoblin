CREATE TABLE template_instances (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  instance TEXT NOT NULL CHECK (json_valid(instance)),
  binding TEXT NOT NULL CHECK (json_valid(binding))
);
--> statement-breakpoint
CREATE INDEX template_instances_owner_idx ON template_instances(owner_id);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN template_subject TEXT CHECK (template_subject IS NULL OR json_valid(template_subject));
--> statement-breakpoint
CREATE UNIQUE INDEX template_issue_attempt_idx ON runs(owner_id, json_extract(template_subject,'$.repository'), json_extract(template_subject,'$.issue'), json_extract(template_subject,'$.attempt'))
WHERE json_extract(template_subject,'$.role')='parent' AND json_extract(template_subject,'$.kind')='implementation';
--> statement-breakpoint
CREATE UNIQUE INDEX template_qa_merge_idx ON runs(owner_id, json_extract(template_subject,'$.repository'), json_extract(template_subject,'$.mergeSha'))
WHERE json_extract(template_subject,'$.role')='parent' AND json_extract(template_subject,'$.kind')='qa';
--> statement-breakpoint
CREATE UNIQUE INDEX template_pr_head_idx ON runs(owner_id, json_extract(template_subject,'$.repository'), json_extract(template_subject,'$.pullRequest'), json_extract(template_subject,'$.head'))
WHERE json_extract(template_subject,'$.role')='parent' AND json_extract(template_subject,'$.kind')='review';
--> statement-breakpoint
CREATE UNIQUE INDEX template_active_pr_idx ON runs(owner_id, json_extract(template_subject,'$.repository'), json_extract(template_subject,'$.pullRequest'))
WHERE json_extract(template_subject,'$.role')='parent' AND json_extract(template_subject,'$.kind')='review' AND status IN ('queued','running','waiting','paused');
--> statement-breakpoint
CREATE UNIQUE INDEX template_child_visit_idx ON runs(json_extract(template_subject,'$.parentRunId'), json_extract(template_subject,'$.nodeId'), json_extract(template_subject,'$.visit'))
WHERE json_extract(template_subject,'$.role')='worker';
