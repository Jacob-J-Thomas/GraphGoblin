-- Model ids are frozen to the 1.0.0 defaults; later models are seeded with max already.
-- CASE guarantees the JSON checks run before json_each, which raises on malformed JSON.
UPDATE `model_catalog`
SET `efforts` = json_insert(`efforts`, '$[#]', 'max')
WHERE `harness` = 'codex'
  AND `model` IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5')
  AND CASE
    WHEN `efforts` IS NULL THEN 0
    WHEN NOT json_valid(`efforts`) THEN 0
    WHEN json_type(`efforts`) <> 'array' THEN 0
    ELSE (SELECT count(DISTINCT value) FROM json_each(`model_catalog`.`efforts`) WHERE value IN ('minimal', 'low', 'medium', 'high', 'xhigh')) = 5
      AND NOT EXISTS (SELECT 1 FROM json_each(`model_catalog`.`efforts`) WHERE value IS NULL OR value NOT IN ('minimal', 'low', 'medium', 'high', 'xhigh'))
  END;
