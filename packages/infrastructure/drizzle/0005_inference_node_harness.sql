UPDATE loop_versions
SET definition = json_remove(definition, '$.settings.defaults.harness')
WHERE json_extract(definition, '$.settings.defaults.harness') IS NOT NULL;
