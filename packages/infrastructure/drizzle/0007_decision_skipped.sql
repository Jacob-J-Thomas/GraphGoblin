-- Historical decisions did not retain skipped-strategy evidence; it cannot be reconstructed.
UPDATE run_events
SET payload = json_set(payload, '$.skipped', json('[]'))
WHERE type = 'decision.made' AND json_type(payload, '$.skipped') IS NULL;
