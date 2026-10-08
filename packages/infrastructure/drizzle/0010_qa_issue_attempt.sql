-- QA owns at most one rework decision for each authenticated issue attempt.
-- Conflicting pre-existing ownership fails migration for manual reconciliation.
CREATE UNIQUE INDEX template_qa_issue_attempt_idx ON runs(owner_id, json_extract(template_subject,'$.repository'), json_extract(template_subject,'$.issue'), json_extract(template_subject,'$.attempt'))
WHERE json_extract(template_subject,'$.role')='parent' AND json_extract(template_subject,'$.kind')='qa' AND json_extract(template_subject,'$.issue') IS NOT NULL AND json_extract(template_subject,'$.attempt') IS NOT NULL;
