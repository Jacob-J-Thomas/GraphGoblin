# Format-4 QA case evidence

Final execution per case ID. All URLs use http://127.0.0.1:4796. The full raw capture was not committed; rerun the scripts to regenerate it.

Secret bodies and HMAC signatures are redacted. Body wire files preserve exact transmitted bytes for all other requests.

## L-expression

create/save/publish/export/import expression

**PASS** — expected: 201 create; 200 save/publish/export; 201 current import; same evaluator config, format 4, empty notices

Observed assertion result: {"loopId":"01M52302G8T01EFQ3D1GEC5ERH","create":201,"save":200,"publish":200,"export":200,"import":201,"kind":"expression","notices":[]}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0197: POST /loops                                    | 201  | {"loop":{"id":"01M52302G8T01EFQ3D1GEC5ERH"},"draft":{"id":"01M52302G81V3XS6W9DHQ66YCJ","schemaVersion":4},"issues":[]}                                                                                              |
| H0198: GET /loops/01M52302G8T01EFQ3D1GEC5ERH          | 200  | {"loop":{"id":"01M52302G8T01EFQ3D1GEC5ERH"},"draft":{"id":"01M52302G81V3XS6W9DHQ66YCJ","schemaVersion":4}}                                                                                                          |
| H0199: PUT /loops/01M52302G8T01EFQ3D1GEC5ERH/draft    | 200  | {"draft":{"id":"01M52302G81V3XS6W9DHQ66YCJ","loopId":"01M52302G8T01EFQ3D1GEC5ERH","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145361406 expression","description":"QA round trip… |
| H0200: POST /loops/01M52302G8T01EFQ3D1GEC5ERH/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0201: GET /loops/01M52302G8T01EFQ3D1GEC5ERH/export   | 200  | {"loop":{},"draft":{}}                                                                                                                                                                                              |
| H0202: POST /loops/import                             | 201  | {"notices":[],"issues":[],"schemaVersion":4}                                                                                                                                                                        |

## L-llm

create/save/publish/export/import llm

**PASS** — expected: 201 create; 200 save/publish/export; 201 current import; same evaluator config, format 4, empty notices

Observed assertion result: {"loopId":"01M52302HP2R6YVHWQGSV14MW4","create":201,"save":200,"publish":200,"export":200,"import":201,"kind":"llm","notices":[]}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0203: POST /loops                                    | 201  | {"loop":{"id":"01M52302HP2R6YVHWQGSV14MW4"},"draft":{"id":"01M52302HPCM7XEY3SJF8B6NJQ","schemaVersion":4},"issues":[]}                                                                                              |
| H0204: GET /loops/01M52302HP2R6YVHWQGSV14MW4          | 200  | {"loop":{"id":"01M52302HP2R6YVHWQGSV14MW4"},"draft":{"id":"01M52302HPCM7XEY3SJF8B6NJQ","schemaVersion":4}}                                                                                                          |
| H0205: PUT /loops/01M52302HP2R6YVHWQGSV14MW4/draft    | 200  | {"draft":{"id":"01M52302HPCM7XEY3SJF8B6NJQ","loopId":"01M52302HP2R6YVHWQGSV14MW4","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145361406 llm","description":"QA round trip llm","… |
| H0206: POST /loops/01M52302HP2R6YVHWQGSV14MW4/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0207: GET /loops/01M52302HP2R6YVHWQGSV14MW4/export   | 200  | {"loop":{},"draft":{}}                                                                                                                                                                                              |
| H0208: POST /loops/import                             | 201  | {"notices":[],"issues":[],"schemaVersion":4}                                                                                                                                                                        |

## L-classifier

create/save/publish/export/import classifier

**PASS** — expected: 201 create; 200 save/publish/export; 201 current import; same evaluator config, format 4, empty notices

Observed assertion result: {"loopId":"01M52302K1B82KCCA9WSBGW7C1","create":201,"save":200,"publish":200,"export":200,"import":201,"kind":"classifier","notices":[]}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0209: POST /loops                                    | 201  | {"loop":{"id":"01M52302K1B82KCCA9WSBGW7C1"},"draft":{"id":"01M52302K1NRFGW8N1RPGR5SYW","schemaVersion":4},"issues":[]}                                                                                              |
| H0210: GET /loops/01M52302K1B82KCCA9WSBGW7C1          | 200  | {"loop":{"id":"01M52302K1B82KCCA9WSBGW7C1"},"draft":{"id":"01M52302K1NRFGW8N1RPGR5SYW","schemaVersion":4}}                                                                                                          |
| H0211: PUT /loops/01M52302K1B82KCCA9WSBGW7C1/draft    | 200  | {"draft":{"id":"01M52302K1NRFGW8N1RPGR5SYW","loopId":"01M52302K1B82KCCA9WSBGW7C1","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145361406 classifier","description":"QA round trip… |
| H0212: POST /loops/01M52302K1B82KCCA9WSBGW7C1/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0213: GET /loops/01M52302K1B82KCCA9WSBGW7C1/export   | 200  | {"loop":{},"draft":{}}                                                                                                                                                                                              |
| H0214: POST /loops/import                             | 201  | {"notices":[],"issues":[],"schemaVersion":4}                                                                                                                                                                        |

## L-reject-subtype

strict contract rejects subtype

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config","message":"Invalid input"}]}

| Request            | HTTP | Response excerpt                                                                                                                                        |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0215: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config","message":"Invalid input"}],"detail":"the request did not match the schema"} |

## L-reject-webhook-filter

strict contract rejects webhook-filter

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/filter","message":"Unrecognized key \"filter\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                             |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0216: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/filter","message":"Unrecognized key \"filter\""}],"detail":"the request did not match the schema"} |

## L-reject-event-filter

strict contract rejects event-filter

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/filter","message":"Unrecognized key \"filter\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                             |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0217: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/filter","message":"Unrecognized key \"filter\""}],"detail":"the request did not match the schema"} |

## L-reject-flat-signature

strict contract rejects flat-signature

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/signature","message":"Unrecognized key \"signature\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                   |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0218: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/signature","message":"Unrecognized key \"signature\""}],"detail":"the request did not match the schema"} |

## L-reject-maxIterations

strict contract rejects maxIterations

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                     |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0219: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}],"detail":"the request did not match the schema"} |

## L-reject-old-exit-fields

strict contract rejects old-exit-fields

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/criteria","message":"Unrecognized key \"criteria\""},{"path":"/definition/nodes/1/config/default","message":"Unrecognized key \"default\""},{"path":"/definition/nodes/1/config/return","message":"Unrecognized key \"return\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0220: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/criteria","message":"Unrecognized key \"criteria\""},{"path":"/definition/nodes/1/config/default","message":"Unrecognized key \"default\… |

## L-reject-old-decision-fields

strict contract rejects old-decision-fields

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/kind","message":"Invalid discriminator value. Expected 'expression' | 'llm' | 'classifier'"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                                      |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0221: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/kind","message":"Invalid discriminator value. Expected 'expression' \| 'llm' \| 'classifier'"}],"detail":"the request did not match the sc… |

## L-reject-event-pointer-text

strict contract rejects event-pointer-text

**PASS** — expected: 400 VALIDATION_FAILED with offending field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/eventType/pointer","message":"JSON pointers require JSON body mode"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                 |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0222: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/eventType/pointer","message":"JSON pointers require JSON body mode"}],"detail":"the request did not match the schema"} |

## L-save-reject

strict draft save/validate rejects old maxIterations

**PASS** — expected: 400 VALIDATION_FAILED on both; original draft unchanged

Observed assertion result: {"save":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}]},"validate":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}]}}

| Request                                                | HTTP | Response excerpt                                                                                                                                                                     |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0223: POST /loops                                     | 201  | {"loop":{"id":"01M52302N710RFVSBRBQA78YZJ"},"draft":{"id":"01M52302N7XJM161E2BRF7HDH9","schemaVersion":4},"issues":[]}                                                               |
| H0224: PUT /loops/01M52302N710RFVSBRBQA78YZJ/draft     | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}],"detail":"the request did not match the schema"} |
| H0225: POST /loops/01M52302N710RFVSBRBQA78YZJ/validate | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/settings/maxIterations","message":"Unrecognized key \"maxIterations\""}],"detail":"the request did not match the schema"} |
| H0226: GET /loops/01M52302N710RFVSBRBQA78YZJ           | 200  | {"loop":{"id":"01M52302N710RFVSBRBQA78YZJ"},"draft":{"id":"01M52302N7XJM161E2BRF7HDH9","schemaVersion":4}}                                                                           |

## L-config-blank-expression

blank-expression

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/jsonata","message":"expression must contain source"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                 |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0227: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/jsonata","message":"expression must contain source"}],"detail":"the request did not match the schema"} |

## L-config-duplicate-routes

duplicate-routes

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/routes/1/id","message":"route ids must be unique"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                               |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0228: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/routes/1/id","message":"route ids must be unique"}],"detail":"the request did not match the schema"} |

## L-config-reserved-port

reserved-port

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/routes/0/id","message":"route ids may not be named \"in\" or \"limit-reached\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                             |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0229: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/routes/0/id","message":"route ids may not be named \"in\" or \"limit-reached\""}],"detail":"the request did not match the schema"} |

## L-config-missing-maxPasses

missing-maxPasses

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/maxPasses","message":"a repeat route requires maxPasses"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                      |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0230: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/maxPasses","message":"a repeat route requires maxPasses"}],"detail":"the request did not match the schema"} |

## L-config-limits-without-repeat

limits-without-repeat

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/maxPasses","message":"gate limits require a repeat route"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                       |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0231: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/maxPasses","message":"gate limits require a repeat route"}],"detail":"the request did not match the schema"} |

## L-config-two-repeats

two-repeats

**PASS** — expected: 400 VALIDATION_FAILED with source path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/routes/1/repeat","message":"at most one route may repeat"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                       |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0232: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/routes/1/repeat","message":"at most one route may repeat"}],"detail":"the request did not match the schema"} |

## L-config-blank-llm

blank-llm

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/instructions","message":"instructions must contain source"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                        |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0233: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/instructions","message":"instructions must contain source"}],"detail":"the request did not match the schema"} |

## L-config-blank-classifier

blank-classifier

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/question","message":"question must contain source"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0234: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/question","message":"question must contain source"}],"detail":"the request did not match the schema"} |

## L-config-inactive-llm-field

inactive-llm-field

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/1/config/instructions","message":"Unrecognized key \"instructions\""}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                         |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0235: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/1/config/instructions","message":"Unrecognized key \"instructions\""}],"detail":"the request did not match the schema"} |

## G-successful-repeat

successful-repeat

**PASS** — expected: terminal succeeded; passes 3; limit null; structured decision evidence and thread counts

Observed assertion result: {"runId":"01M52302QA6MMAY8F9781YH1SA","status":"succeeded","result":{"passes":3,"visited":true},"threadGate":{"passes":3},"lastDecision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"done","confidence":null,"reasoning":null},"portId":"done","gate":{"previousPasses":3,"passes":3,"repeatRouteId":"again","maxPasses":3,"elapsedSeconds":0.08,"limit":null},"diagnostics":[],"runId":"01M52302QA6MMAY8F9781YH1SA","seq":16,"ts":"2026-10-16T10:09:21.730Z","type":"decision.made","nodeId":"gate"},"decisionCount":3}

| Request                                                       | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0236: POST /loops                                            | 201  | {"loop":{"id":"01M52302PR9DSVKQYNS4Q8QSH8"},"draft":{"id":"01M52302PRSZJWDACDAV512WWS","schemaVersion":4},"issues":[]}                                                                                              |
| H0237: POST /loops/01M52302PR9DSVKQYNS4Q8QSH8/publish         | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0238: POST /loops/01M52302PR9DSVKQYNS4Q8QSH8/runs            | 202  | {"run":{"id":"01M52302QA6MMAY8F9781YH1SA","ownerId":"local","loopId":"01M52302PR9DSVKQYNS4Q8QSH8","versionId":"01M52302PRSZJWDACDAV512WWS","invocationId":"01M52302QAZYZ3FQWA38EHBENV","status":"queued","iteratio… |
| H0239: GET /runs/01M52302QA6MMAY8F9781YH1SA                   | 200  | {"id":"01M52302QA6MMAY8F9781YH1SA","ownerId":"local","loopId":"01M52302PR9DSVKQYNS4Q8QSH8","versionId":"01M52302PRSZJWDACDAV512WWS","invocationId":"01M52302QAZYZ3FQWA38EHBENV","status":"queued","iteration":1,"c… |
| H0240: GET /runs/01M52302QA6MMAY8F9781YH1SA                   | 200  | {"status":"succeeded","outcome":"success","result":{"passes":3,"visited":true}}                                                                                                                                     |
| H0241: GET /runs/01M52302QA6MMAY8F9781YH1SA/thread            | 200  | {"schemaVersion":1,"run":{"id":"01M52302QA6MMAY8F9781YH1SA","loopId":"01M52302PR9DSVKQYNS4Q8QSH8","versionId":"01M52302PRSZJWDACDAV512WWS","iteration":1},"invocation":{"id":"01M52302QAZYZ3FQWA38EHBENV","source"… |
| H0242: GET /runs/01M52302QA6MMAY8F9781YH1SA/events?limit=1000 | 200  | {"items":[{"runId":"01M52302QA6MMAY8F9781YH1SA","seq":1,"ts":"2026-10-16T10:09:21.642Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52302QA6MMAY8F9781YH1SA","loopId":"01M52302PR9DSVKQ… |

## G-max-passes

max-passes

**PASS** — expected: terminal exhausted; passes 3; limit max-passes; structured decision evidence and thread counts

Observed assertion result: {"runId":"01M52302VTYDC2W9FTM2BQGHA2","status":"exhausted","result":{"passes":3},"threadGate":{"passes":3},"lastDecision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"limit-reached","gate":{"previousPasses":3,"passes":3,"repeatRouteId":"again","maxPasses":3,"elapsedSeconds":0.059,"limit":"max-passes"},"diagnostics":[],"runId":"01M52302VTYDC2W9FTM2BQGHA2","seq":16,"ts":"2026-10-16T10:09:21.851Z","type":"decision.made","nodeId":"gate"},"decisionCount":3}

| Request                                                       | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0243: POST /loops                                            | 201  | {"loop":{"id":"01M52302VA4617NA9ZR1GC1YA5"},"draft":{"id":"01M52302VA59PHT7J5MDGNHQKQ","schemaVersion":4},"issues":[]}                                                                                              |
| H0244: POST /loops/01M52302VA4617NA9ZR1GC1YA5/publish         | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0245: POST /loops/01M52302VA4617NA9ZR1GC1YA5/runs            | 202  | {"run":{"id":"01M52302VTYDC2W9FTM2BQGHA2","ownerId":"local","loopId":"01M52302VA4617NA9ZR1GC1YA5","versionId":"01M52302VA59PHT7J5MDGNHQKQ","invocationId":"01M52302VTCWFM57TSTFDV43RW","status":"queued","iteratio… |
| H0246: GET /runs/01M52302VTYDC2W9FTM2BQGHA2                   | 200  | {"id":"01M52302VTYDC2W9FTM2BQGHA2","ownerId":"local","loopId":"01M52302VA4617NA9ZR1GC1YA5","versionId":"01M52302VA59PHT7J5MDGNHQKQ","invocationId":"01M52302VTCWFM57TSTFDV43RW","status":"running","iteration":1,"… |
| H0247: GET /runs/01M52302VTYDC2W9FTM2BQGHA2                   | 200  | {"status":"exhausted","outcome":"exhausted","result":{"passes":3}}                                                                                                                                                  |
| H0248: GET /runs/01M52302VTYDC2W9FTM2BQGHA2/thread            | 200  | {"schemaVersion":1,"run":{"id":"01M52302VTYDC2W9FTM2BQGHA2","loopId":"01M52302VA4617NA9ZR1GC1YA5","versionId":"01M52302VA59PHT7J5MDGNHQKQ","iteration":1},"invocation":{"id":"01M52302VTCWFM57TSTFDV43RW","source"… |
| H0249: GET /runs/01M52302VTYDC2W9FTM2BQGHA2/events?limit=1000 | 200  | {"items":[{"runId":"01M52302VTYDC2W9FTM2BQGHA2","seq":1,"ts":"2026-10-16T10:09:21.786Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52302VTYDC2W9FTM2BQGHA2","loopId":"01M52302VA4617NA… |

## G-max-time

max-time

**PASS** — expected: terminal exhausted; passes 1; limit max-run-time; structured decision evidence and thread counts

Observed assertion result: {"runId":"01M523030MT6QY88RMJ6BCYKHV","status":"exhausted","result":{"passes":1},"threadGate":{"passes":1},"lastDecision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"limit-reached","gate":{"previousPasses":1,"passes":1,"repeatRouteId":"again","maxPasses":8,"maxRunTimeSeconds":1,"elapsedSeconds":1.411,"limit":"max-run-time"},"diagnostics":[],"runId":"01M523030MT6QY88RMJ6BCYKHV","seq":9,"ts":"2026-10-16T10:09:23.357Z","type":"decision.made","nodeId":"gate"},"decisionCount":1}

| Request                                                       | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0250: POST /loops                                            | 201  | {"loop":{"id":"01M5230305PTVBM17WHKQ67S98"},"draft":{"id":"01M5230305342TSKW5MP959JH3","schemaVersion":4},"issues":[]}                                                                                              |
| H0251: POST /loops/01M5230305PTVBM17WHKQ67S98/publish         | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0252: POST /loops/01M5230305PTVBM17WHKQ67S98/runs            | 202  | {"run":{"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"queued","iteratio… |
| H0253: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"queued","iteration":1,"c… |
| H0254: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0255: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0256: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0257: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0258: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0259: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0260: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0261: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0262: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0263: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0264: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0265: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0266: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"id":"01M523030MT6QY88RMJ6BCYKHV","ownerId":"local","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","invocationId":"01M523030MHK9GBTHDZT0Z5X0N","status":"running","currentNodeId"… |
| H0267: GET /runs/01M523030MT6QY88RMJ6BCYKHV                   | 200  | {"status":"exhausted","outcome":"exhausted","result":{"passes":1}}                                                                                                                                                  |
| H0268: GET /runs/01M523030MT6QY88RMJ6BCYKHV/thread            | 200  | {"schemaVersion":1,"run":{"id":"01M523030MT6QY88RMJ6BCYKHV","loopId":"01M5230305PTVBM17WHKQ67S98","versionId":"01M5230305342TSKW5MP959JH3","iteration":1},"invocation":{"id":"01M523030MHK9GBTHDZT0Z5X0N","source"… |
| H0269: GET /runs/01M523030MT6QY88RMJ6BCYKHV/events?limit=1000 | 200  | {"items":[{"runId":"01M523030MT6QY88RMJ6BCYKHV","seq":1,"ts":"2026-10-16T10:09:21.940Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M523030MT6QY88RMJ6BCYKHV","loopId":"01M5230305PTVBM1… |

## G-finish-after-time

finish-after-time

**PASS** — expected: terminal succeeded; passes 1; limit null; structured decision evidence and thread counts

Observed assertion result: {"runId":"01M52304H5XS166DW6QA59CDVW","status":"succeeded","result":{"passes":1},"threadGate":{"passes":1},"lastDecision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"done","confidence":null,"reasoning":null},"portId":"done","gate":{"previousPasses":1,"passes":1,"repeatRouteId":"again","maxPasses":8,"maxRunTimeSeconds":1,"elapsedSeconds":1.41,"limit":null},"diagnostics":[],"runId":"01M52304H5XS166DW6QA59CDVW","seq":9,"ts":"2026-10-16T10:09:24.909Z","type":"decision.made","nodeId":"gate"},"decisionCount":1}

| Request                                                       | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0270: POST /loops                                            | 201  | {"loop":{"id":"01M52304GH6155JWW6DYS93PFE"},"draft":{"id":"01M52304GJDFFQJW6HDXTM10J0","schemaVersion":4},"issues":[]}                                                                                              |
| H0271: POST /loops/01M52304GH6155JWW6DYS93PFE/publish         | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0272: POST /loops/01M52304GH6155JWW6DYS93PFE/runs            | 202  | {"run":{"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"queued","iteratio… |
| H0273: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","iteration":1,"… |
| H0274: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0275: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0276: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0277: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0278: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0279: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0280: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0281: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0282: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0283: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0284: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0285: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0286: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"id":"01M52304H5XS166DW6QA59CDVW","ownerId":"local","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","invocationId":"01M52304H5X6XCTGSCWVWEEWS9","status":"running","currentNodeId"… |
| H0287: GET /runs/01M52304H5XS166DW6QA59CDVW                   | 200  | {"status":"succeeded","outcome":"success","result":{"passes":1}}                                                                                                                                                    |
| H0288: GET /runs/01M52304H5XS166DW6QA59CDVW/thread            | 200  | {"schemaVersion":1,"run":{"id":"01M52304H5XS166DW6QA59CDVW","loopId":"01M52304GH6155JWW6DYS93PFE","versionId":"01M52304GJDFFQJW6HDXTM10J0","iteration":1},"invocation":{"id":"01M52304H5X6XCTGSCWVWEEWS9","source"… |
| H0289: GET /runs/01M52304H5XS166DW6QA59CDVW/events?limit=1000 | 200  | {"items":[{"runId":"01M52304H5XS166DW6QA59CDVW","seq":1,"ts":"2026-10-16T10:09:23.493Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52304H5XS166DW6QA59CDVW","loopId":"01M52304GH6155JW… |

## G-both-limits

both-limits

**PASS** — expected: terminal exhausted; passes 1; limit max-passes; structured decision evidence and thread counts

Observed assertion result: {"runId":"01M523061J5TVAGJY3GAK3PKJ2","status":"exhausted","result":{"passes":1},"threadGate":{"passes":1},"lastDecision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"limit-reached","gate":{"previousPasses":1,"passes":1,"repeatRouteId":"again","maxPasses":1,"maxRunTimeSeconds":1,"elapsedSeconds":1.423,"limit":"max-passes"},"diagnostics":[],"runId":"01M523061J5TVAGJY3GAK3PKJ2","seq":9,"ts":"2026-10-16T10:09:26.471Z","type":"decision.made","nodeId":"gate"},"decisionCount":1}

| Request                                                       | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0290: POST /loops                                            | 201  | {"loop":{"id":"01M5230611A0PRR42JZ24BWY68"},"draft":{"id":"01M52306118VGS36F68Q5P9EX1","schemaVersion":4},"issues":[]}                                                                                              |
| H0291: POST /loops/01M5230611A0PRR42JZ24BWY68/publish         | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0292: POST /loops/01M5230611A0PRR42JZ24BWY68/runs            | 202  | {"run":{"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"queued","iteratio… |
| H0293: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","iteration":1,"… |
| H0294: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0295: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0296: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0297: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0298: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0299: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0300: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0301: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0302: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0303: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0304: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0305: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0306: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"id":"01M523061J5TVAGJY3GAK3PKJ2","ownerId":"local","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","invocationId":"01M523061JF6DGASA7RRR4Z7RN","status":"running","currentNodeId"… |
| H0307: GET /runs/01M523061J5TVAGJY3GAK3PKJ2                   | 200  | {"status":"exhausted","outcome":"exhausted","result":{"passes":1}}                                                                                                                                                  |
| H0308: GET /runs/01M523061J5TVAGJY3GAK3PKJ2/thread            | 200  | {"schemaVersion":1,"run":{"id":"01M523061J5TVAGJY3GAK3PKJ2","loopId":"01M5230611A0PRR42JZ24BWY68","versionId":"01M52306118VGS36F68Q5P9EX1","iteration":1},"invocation":{"id":"01M523061JF6DGASA7RRR4Z7RN","source"… |
| H0309: GET /runs/01M523061J5TVAGJY3GAK3PKJ2/events?limit=1000 | 200  | {"items":{"runId":"01M523061J5TVAGJY3GAK3PKJ2","seq":1,"ts":"2026-10-16T10:09:25.042Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M523061J5TVAGJY3GAK3PKJ2","loopId":"01M5230611A0PRR4…  |

## G-warning

gate maxPasses exceeds visit cap across admissions

**PASS** — expected: GATE_PASSES_ABOVE_VISIT_CAP warning with both numbers/cycle nodes; publication allowed

Observed assertion result: {"create":201,"validate":200,"save":200,"publish":200,"import":201,"warnings":[{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued repetition will fail with MAX_NODE_VISITS before the maximum-pass Limit reached output. Lower maximum passes or raise the visit cap.","nodeId":"gate","path":"config.maxPasses"},{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued repetition will fail with MAX_NODE_VISITS before the maximum-pass Limit reached output. Lower maximum passes or raise the visit cap.","nodeId":"gate","path":"config.maxPasses"},{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued repetition will fail with MAX_NODE_VISITS before the maximum-pass Limit reached output. Lower maximum passes or raise the visit cap.","nodeId":"gate","path":"config.maxPasses"},{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued repetition will fail with MAX_NODE_VISITS before the maxim…

| Request                                                 | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0310: POST /loops                                     | 201  | {"loop":{"id":"01M52307HV5BH5JR1MPR37VD81"},"draft":{"id":"01M52307HVA75H1JZCFYDQ2QGT","schemaVersion":4},"issues":{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPas…  |
| [H0311: POST /loops/01M52307HV5BH5JR1MPR37VD81/validate | 200  | {"issues":{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued repetition will …  |
| [H0312: GET /loops/01M52307HV5BH5JR1MPR37VD81           | 200  | {"loop":{"id":"01M52307HV5BH5JR1MPR37VD81"},"draft":{"id":"01M52307HVA75H1JZCFYDQ2QGT","schemaVersion":4}}                                                                                                          |
| H0313: PUT /loops/01M52307HV5BH5JR1MPR37VD81/draft      | 200  | {"draft":{"id":"01M52307HVA75H1JZCFYDQ2QGT","loopId":"01M52307HV5BH5JR1MPR37VD81","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145361406 warning","settings":{"workingDirectory":… |
| H0314: POST /loops/01M52307HV5BH5JR1MPR37VD81/publish   | 200  | {"version":1,"schemaVersion":4,"issues":{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work…  |
| [H0315: GET /loops/01M52307HV5BH5JR1MPR37VD81/export    | 200  | {"loop":{},"draft":{}}                                                                                                                                                                                              |
| H0316: POST /loops/import                               | 201  | {"notices":[],"issues":[{"code":"GATE_PASSES_ABOVE_VISIT_CAP","severity":"warning","message":"gate \"gate\" has maxPasses 5, above settings.maxNodeVisits 3. Repeat-cycle nodes: \"gate\", \"work\". Continued rep… |

## G-invalid-repeat-not-cyclic

repeat-not-cyclic

**PASS** — expected: draft issues include REPEAT_ROUTE_NOT_CYCLIC; publish 422 LOOP_INVALID

Observed assertion result: {"issues":[{"code":"REPEAT_ROUTE_NOT_CYCLIC","severity":"error","message":"a repeat route must lead back to its decision gate","nodeId":"gate","edgeId":"e2","path":"config.routes.0.repeat"},{"code":"NODE_UNREACHABLE","severity":"error","message":"node \"work\" is not reachable from any trigger","nodeId":"work"}],"publish":{"type":"https://graphgoblin.dev/problems/loop-invalid","title":"loop invalid","status":422,"code":"LOOP_INVALID","detail":"the draft has structural errors","errors":[{"code":"REPEAT_ROUTE_NOT_CYCLIC","severity":"error","nodeId":"gate","edgeId":"e2","path":"config.routes.0.repeat","message":"a repeat route must lead back to its decision gate"},{"code":"NODE_UNREACHABLE","severity":"error","message":"node \"work\" is not reachable from any trigger","nodeId":"work"}]}}

| Request                                                | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0317: POST /loops                                     | 201  | {"loop":{"id":"01M52307K6Y2B80K9NNR6D95QZ"},"draft":{"id":"01M52307K638JP6A5Q7ZV4T6W1","schemaVersion":4},"issues":{"code":"REPEAT_ROUTE_NOT_CYCLIC","severity":"error","message":"a repeat route must lead back …  |
| [H0318: POST /loops/01M52307K6Y2B80K9NNR6D95QZ/publish | 422  | {"code":"LOOP_INVALID","errors":[{"code":"REPEAT_ROUTE_NOT_CYCLIC","severity":"error","nodeId":"gate","edgeId":"e2","path":"config.routes.0.repeat","message":"a repeat route must lead back to its decision gate"… |

## G-invalid-missing-limit-edge

missing-limit-edge

**PASS** — expected: draft issues include PORT_UNCONNECTED; publish 422 LOOP_INVALID

Observed assertion result: {"issues":[{"code":"PORT_UNCONNECTED","severity":"error","message":"port \"limit-reached\" of node \"gate\" is not connected","nodeId":"gate","path":"config.maxPasses"},{"code":"NODE_UNREACHABLE","severity":"error","message":"node \"exhausted\" is not reachable from any trigger","nodeId":"exhausted"}],"publish":{"type":"https://graphgoblin.dev/problems/loop-invalid","title":"loop invalid","status":422,"code":"LOOP_INVALID","detail":"the draft has structural errors","errors":[{"code":"PORT_UNCONNECTED","severity":"error","message":"port \"limit-reached\" of node \"gate\" is not connected","nodeId":"gate","path":"config.maxPasses"},{"code":"NODE_UNREACHABLE","severity":"error","message":"node \"exhausted\" is not reachable from any trigger","nodeId":"exhausted"}]}}

| Request                                                | HTTP | Response excerpt                                                                                                                                                                                                   |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0319: POST /loops                                     | 201  | {"loop":{"id":"01M52307KJZN0DQW0S433JFSQ3"},"draft":{"id":"01M52307KJQN6Q81W6R5BF8665","schemaVersion":4},"issues":{"code":"PORT_UNCONNECTED","severity":"error","message":"port \"limit-reached\" of node \"gate… |
| [H0320: POST /loops/01M52307KJZN0DQW0S433JFSQ3/publish | 422  | {"code":"LOOP_INVALID","errors":{"code":"PORT_UNCONNECTED","severity":"error","message":"port \"limit-reached\" of node \"gate\" is not connected","nodeId":"gate","path":"config.maxPasses"},{"code":"NODE_UNREA… |

## G-visit-cap

unmarked runaway hits independent visit cap

**PASS** — expected: failed MAX_NODE_VISITS, nonresumable; details.maxNodeVisits=2

Observed assertion result: {"id":"01M52307MECDF4BTW91P837VH4","ownerId":"local","loopId":"01M52307KZM5AYMS21WSPCTA4A","versionId":"01M52307KZGNC4C8FBB4X5A7YP","invocationId":"01M52307MEVR4HMH7S6RK5QSPV","status":"failed","currentNodeId":"choose","iteration":1,"failure":{"code":"MAX_NODE_VISITS","message":"node \"choose\" would start for visit 3, above the loop's maxNodeVisits of 2","nodeId":"choose","resumable":false,"details":{"maxNodeVisits":2}},"createdAt":"2026-10-16T10:09:26.670Z","startedAt":"2026-10-16T10:09:26.676Z","finishedAt":"2026-10-16T10:09:26.765Z","lastEventSeq":15}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0321: POST /loops                                   | 201  | {"loop":{"id":"01M52307KZM5AYMS21WSPCTA4A"},"draft":{"id":"01M52307KZGNC4C8FBB4X5A7YP","schemaVersion":4},"issues":[]}                                                                                              |
| H0322: POST /loops/01M52307KZM5AYMS21WSPCTA4A/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0323: POST /loops/01M52307KZM5AYMS21WSPCTA4A/runs    | 202  | {"run":{"id":"01M52307MECDF4BTW91P837VH4","ownerId":"local","loopId":"01M52307KZM5AYMS21WSPCTA4A","versionId":"01M52307KZGNC4C8FBB4X5A7YP","invocationId":"01M52307MEVR4HMH7S6RK5QSPV","status":"queued","iteratio… |
| H0324: GET /runs/01M52307MECDF4BTW91P837VH4           | 200  | {"id":"01M52307MECDF4BTW91P837VH4","ownerId":"local","loopId":"01M52307KZM5AYMS21WSPCTA4A","versionId":"01M52307KZGNC4C8FBB4X5A7YP","invocationId":"01M52307MEVR4HMH7S6RK5QSPV","status":"queued","iteration":1,"c… |
| H0325: GET /runs/01M52307MECDF4BTW91P837VH4           | 200  | {"status":"failed","failure":{"code":"MAX_NODE_VISITS","resumable":false,"details":{"maxNodeVisits":2}}}                                                                                                            |

## G-runtime-non-string

expression non-string route fails

**PASS** — expected: typed nonresumable evaluator failure; no fallback or decision output

Observed assertion result: {"id":"01M52307REM1A4MEV57064DRTQ","ownerId":"local","loopId":"01M52307QZKV67Q8T9YCD809PG","versionId":"01M52307QZP0GSWGVZY63GPW4V","invocationId":"01M52307RERMD0J9RNBEN1F1ZB","status":"failed","currentNodeId":"choose","iteration":1,"failure":{"code":"EVALUATION_INVALID_RESPONSE","message":"The decision expression must return a declared scalar string route id","nodeId":"choose","resumable":false},"createdAt":"2026-10-16T10:09:26.798Z","startedAt":"2026-10-16T10:09:26.803Z","finishedAt":"2026-10-16T10:09:26.829Z","lastEventSeq":6}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0326: POST /loops                                    | 201  | {"loop":{"id":"01M52307QZKV67Q8T9YCD809PG"},"draft":{"id":"01M52307QZP0GSWGVZY63GPW4V","schemaVersion":4},"issues":[]}                                                                                              |
| H0327: POST /loops/01M52307QZKV67Q8T9YCD809PG/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0328: POST /loops/01M52307QZKV67Q8T9YCD809PG/runs    | 202  | {"run":{"id":"01M52307REM1A4MEV57064DRTQ","ownerId":"local","loopId":"01M52307QZKV67Q8T9YCD809PG","versionId":"01M52307QZP0GSWGVZY63GPW4V","invocationId":"01M52307RERMD0J9RNBEN1F1ZB","status":"queued","iteratio… |
| H0329: GET /runs/01M52307REM1A4MEV57064DRTQ           | 200  | {"id":"01M52307REM1A4MEV57064DRTQ","ownerId":"local","loopId":"01M52307QZKV67Q8T9YCD809PG","versionId":"01M52307QZP0GSWGVZY63GPW4V","invocationId":"01M52307RERMD0J9RNBEN1F1ZB","status":"running","iteration":1,"… |
| H0330: GET /runs/01M52307REM1A4MEV57064DRTQ           | 200  | {"status":"failed","failure":{"code":"EVALUATION_INVALID_RESPONSE","resumable":false}}                                                                                                                              |
| H0331: GET /runs/01M52307REM1A4MEV57064DRTQ/events    | 200  | {"items":{"runId":"01M52307REM1A4MEV57064DRTQ","seq":1,"ts":"2026-10-16T10:09:26.798Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52307REM1A4MEV57064DRTQ","loopId":"01M52307QZKV67Q8…  |

## G-runtime-undeclared

expression undeclared route fails

**PASS** — expected: typed nonresumable evaluator failure; no fallback or decision output

Observed assertion result: {"id":"01M52307WXVNV86750EDDS2A1N","ownerId":"local","loopId":"01M52307WEMZGRD548C00NVJJW","versionId":"01M52307WEBQP3QB490WG1RRQR","invocationId":"01M52307WX4C0PZVEMWCVEF6T6","status":"failed","currentNodeId":"choose","iteration":1,"failure":{"code":"EVALUATION_INVALID_RESPONSE","message":"The decision expression must return a declared scalar string route id","nodeId":"choose","resumable":false},"createdAt":"2026-10-16T10:09:26.941Z","startedAt":"2026-10-16T10:09:26.946Z","finishedAt":"2026-10-16T10:09:26.970Z","lastEventSeq":6}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0332: POST /loops                                   | 201  | {"loop":{"id":"01M52307WEMZGRD548C00NVJJW"},"draft":{"id":"01M52307WEBQP3QB490WG1RRQR","schemaVersion":4},"issues":[]}                                                                                              |
| H0333: POST /loops/01M52307WEMZGRD548C00NVJJW/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0334: POST /loops/01M52307WEMZGRD548C00NVJJW/runs    | 202  | {"run":{"id":"01M52307WXVNV86750EDDS2A1N","ownerId":"local","loopId":"01M52307WEMZGRD548C00NVJJW","versionId":"01M52307WEBQP3QB490WG1RRQR","invocationId":"01M52307WX4C0PZVEMWCVEF6T6","status":"queued","iteratio… |
| H0335: GET /runs/01M52307WXVNV86750EDDS2A1N           | 200  | {"id":"01M52307WXVNV86750EDDS2A1N","ownerId":"local","loopId":"01M52307WEMZGRD548C00NVJJW","versionId":"01M52307WEBQP3QB490WG1RRQR","invocationId":"01M52307WX4C0PZVEMWCVEF6T6","status":"running","iteration":1,"… |
| H0336: GET /runs/01M52307WXVNV86750EDDS2A1N           | 200  | {"status":"failed","failure":{"code":"EVALUATION_INVALID_RESPONSE","resumable":false}}                                                                                                                              |
| H0337: GET /runs/01M52307WXVNV86750EDDS2A1N/events    | 200  | {"items":{"runId":"01M52307WXVNV86750EDDS2A1N","seq":1,"ts":"2026-10-16T10:09:26.941Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52307WXVNV86750EDDS2A1N","loopId":"01M52307WEMZGRD5…  |

## G-runtime-undefined

expression undefined route fails

**PASS** — expected: typed nonresumable evaluator failure; no fallback or decision output

Observed assertion result: {"id":"01M5230818P0VVXDJ0903F3FZ7","ownerId":"local","loopId":"01M523080RRP3VCFFAF4YARDE6","versionId":"01M523080R4ZYF40YRV729V0ZH","invocationId":"01M5230818GB62PR6SP6EARX0C","status":"failed","currentNodeId":"choose","iteration":1,"failure":{"code":"EVALUATION_INVALID_RESPONSE","message":"The decision expression must return a declared scalar string route id","nodeId":"choose","resumable":false},"createdAt":"2026-10-16T10:09:27.080Z","startedAt":"2026-10-16T10:09:27.085Z","finishedAt":"2026-10-16T10:09:27.108Z","lastEventSeq":6}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0338: POST /loops                                   | 201  | {"loop":{"id":"01M523080RRP3VCFFAF4YARDE6"},"draft":{"id":"01M523080R4ZYF40YRV729V0ZH","schemaVersion":4},"issues":[]}                                                                                              |
| H0339: POST /loops/01M523080RRP3VCFFAF4YARDE6/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0340: POST /loops/01M523080RRP3VCFFAF4YARDE6/runs    | 202  | {"run":{"id":"01M5230818P0VVXDJ0903F3FZ7","ownerId":"local","loopId":"01M523080RRP3VCFFAF4YARDE6","versionId":"01M523080R4ZYF40YRV729V0ZH","invocationId":"01M5230818GB62PR6SP6EARX0C","status":"queued","iteratio… |
| H0341: GET /runs/01M5230818P0VVXDJ0903F3FZ7           | 200  | {"id":"01M5230818P0VVXDJ0903F3FZ7","ownerId":"local","loopId":"01M523080RRP3VCFFAF4YARDE6","versionId":"01M523080R4ZYF40YRV729V0ZH","invocationId":"01M5230818GB62PR6SP6EARX0C","status":"running","iteration":1,"… |
| H0342: GET /runs/01M5230818P0VVXDJ0903F3FZ7           | 200  | {"status":"failed","failure":{"code":"EVALUATION_INVALID_RESPONSE","resumable":false}}                                                                                                                              |
| H0343: GET /runs/01M5230818P0VVXDJ0903F3FZ7/events    | 200  | {"items":[{"runId":"01M5230818P0VVXDJ0903F3FZ7","seq":1,"ts":"2026-10-16T10:09:27.080Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5230818P0VVXDJ0903F3FZ7","loopId":"01M523080RRP3VCF… |

## G-failure-return

terminal Failure returns mapped data and cannot resume

**PASS** — expected: failed with unchanged result; return.delivered; resume 409

Observed assertion result: {"snapshot":{"id":"01M523085K3J50MHDP0H42JV91","ownerId":"local","loopId":"01M52308541BXR8KF7HT2B1QDB","versionId":"01M5230854Y19ZF2B2P7VMWASG","invocationId":"01M523085KCXD16PFCNY7CARS6","status":"failed","iteration":1,"outcome":"failure","result":{"reason":"qa-failure","detail":{"x":7}},"createdAt":"2026-10-16T10:09:27.219Z","startedAt":"2026-10-16T10:09:27.224Z","finishedAt":"2026-10-16T10:09:27.249Z","lastEventSeq":9},"resume":{"type":"https://graphgoblin.dev/problems/invalid-state","title":"invalid state","status":409,"code":"INVALID_STATE","detail":"cannot resume a run that is failed"},"terminalEvents":[{"runId":"01M523085K3J50MHDP0H42JV91","seq":6,"ts":"2026-10-16T10:09:27.246Z","type":"exit.evaluated","nodeId":"done","outcome":"failure"},{"runId":"01M523085K3J50MHDP0H42JV91","seq":8,"ts":"2026-10-16T10:09:27.246Z","type":"run.finished","status":"failed","outcome":"failure","result":{"reason":"qa-failure","detail":{"x":7}}},{"runId":"01M523085K3J50MHDP0H42JV91","seq":9,"ts":"2026-10-16T10:09:27.252Z","type":"return.delivered","channel":{"kind":"caller"},"target":"run.result"}]}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0344: POST /loops                                    | 201  | {"loop":{"id":"01M52308541BXR8KF7HT2B1QDB"},"draft":{"id":"01M5230854Y19ZF2B2P7VMWASG","schemaVersion":4},"issues":[]}                                                                                              |
| H0345: POST /loops/01M52308541BXR8KF7HT2B1QDB/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0346: POST /loops/01M52308541BXR8KF7HT2B1QDB/runs    | 202  | {"run":{"id":"01M523085K3J50MHDP0H42JV91","ownerId":"local","loopId":"01M52308541BXR8KF7HT2B1QDB","versionId":"01M5230854Y19ZF2B2P7VMWASG","invocationId":"01M523085KCXD16PFCNY7CARS6","status":"queued","iteratio… |
| H0347: GET /runs/01M523085K3J50MHDP0H42JV91           | 200  | {"id":"01M523085K3J50MHDP0H42JV91","ownerId":"local","loopId":"01M52308541BXR8KF7HT2B1QDB","versionId":"01M5230854Y19ZF2B2P7VMWASG","invocationId":"01M523085KCXD16PFCNY7CARS6","status":"running","iteration":1,"… |
| H0348: GET /runs/01M523085K3J50MHDP0H42JV91           | 200  | {"status":"failed","outcome":"failure","result":{"reason":"qa-failure","detail":{"x":7}}}                                                                                                                           |
| H0349: GET /runs/01M523085K3J50MHDP0H42JV91/events    | 200  | {"items":{"runId":"01M523085K3J50MHDP0H42JV91","seq":1,"ts":"2026-10-16T10:09:27.219Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M523085K3J50MHDP0H42JV91","loopId":"01M52308541BXR8K…  |
| [H0350: POST /runs/01M523085K3J50MHDP0H42JV91/resume  | 409  | {"code":"INVALID_STATE","detail":"cannot resume a run that is failed"}                                                                                                                                              |

## G-return-error

invalid return mapping follows node failure handling

**PASS** — expected: failed with a node failure; no terminal exit run.finished

Observed assertion result: {"id":"01M52308A2MEYBA9ZREWYKG9RT","ownerId":"local","loopId":"01M523089M2GEWX37MSMJNRCKE","versionId":"01M523089MJZ5KH5ZPYJ68FGEQ","invocationId":"01M52308A20EEQJEFPMGQPSFNE","status":"failed","currentNodeId":"done","iteration":1,"failure":{"code":"INTERNAL_ERROR","message":"expression failed: qa mapping error","nodeId":"done","resumable":true,"details":{"name":"ExpressionError","stack":"ExpressionError: expression failed: qa mapping error\n at run (file:///<local>/source/repos/GraphGoblin/.claude/worktrees/qa-4796/packages/domain/dist/expression.js:123:15)\n at async Object.execute (file:///<local>/source/repos/GraphGoblin/.claude/worktrees/qa-4796/packages/engine/dist/handlers/exit.js:10:22)\n at async RunManager.execute (file:///<local>/source/repos/GraphGoblin/.claude/worktrees/qa-4796/packages/engine/dist/run-manager.js:1157:26)"}},"createdAt":"2026-10-16T10:09:27.362Z","startedAt":"2026-10-16T10:09:27.367Z","finishedAt":"2026-10-16T10:09:27.385Z","lastEventSeq":6}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0351: POST /loops                                    | 201  | {"loop":{"id":"01M523089M2GEWX37MSMJNRCKE"},"draft":{"id":"01M523089MJZ5KH5ZPYJ68FGEQ","schemaVersion":4},"issues":[]}                                                                                              |
| H0352: POST /loops/01M523089M2GEWX37MSMJNRCKE/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0353: POST /loops/01M523089M2GEWX37MSMJNRCKE/runs    | 202  | {"run":{"id":"01M52308A2MEYBA9ZREWYKG9RT","ownerId":"local","loopId":"01M523089M2GEWX37MSMJNRCKE","versionId":"01M523089MJZ5KH5ZPYJ68FGEQ","invocationId":"01M52308A20EEQJEFPMGQPSFNE","status":"queued","iteratio… |
| H0354: GET /runs/01M52308A2MEYBA9ZREWYKG9RT           | 200  | {"id":"01M52308A2MEYBA9ZREWYKG9RT","ownerId":"local","loopId":"01M523089M2GEWX37MSMJNRCKE","versionId":"01M523089MJZ5KH5ZPYJ68FGEQ","invocationId":"01M52308A20EEQJEFPMGQPSFNE","status":"running","iteration":1,"… |
| H0355: GET /runs/01M52308A2MEYBA9ZREWYKG9RT           | 200  | {"status":"failed","failure":{"code":"INTERNAL_ERROR","resumable":true}}                                                                                                                                            |
| H0356: GET /runs/01M52308A2MEYBA9ZREWYKG9RT/events    | 200  | {"items":[{"runId":"01M52308A2MEYBA9ZREWYKG9RT","seq":1,"ts":"2026-10-16T10:09:27.362Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52308A2MEYBA9ZREWYKG9RT","loopId":"01M523089M2GEWX3… |

## W-auth-none

none authentication uses exact UTF-8 bytes

**PASS** — expected: 202 exactly {accepted:true}; async run payload preserved and invocation eventType set

Observed assertion result: {"ack":{"accepted":true},"runId":"01M52339NGM8CSC7BCBK4PH4F1","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.056Z","eventType":"qa-none"},"first":{"runId":"01M52339NGM8CSC7BCBK4PH4F1","seq":1,"ts":"2026-10-16T10:11:07.056Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339NGM8CSC7BCBK4PH4F1","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","iteration":1},"invocation":{"id":"01M52339NG3FY1YQC9G29190D5","source":"webhook","caller":{"kind":"system","id":"webhook:01M52339KPTSXM1NYAFKGMYFJD"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.056Z","eventType":"qa-none"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0680: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0681: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0682: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":{"id":"01M52339NGM8CSC7BCBK4PH4F1","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M52339NG3FY1YQC9G29190D5","status":"queued","itera…  |
| [H0683: GET /runs/01M52339NGM8CSC7BCBK4PH4F1                     | 200  | {"id":"01M52339NGM8CSC7BCBK4PH4F1","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M52339NG3FY1YQC9G29190D5","status":"running","iteration":1,"… |
| H0684: GET /runs/01M52339NGM8CSC7BCBK4PH4F1                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0685: GET /runs/01M52339NGM8CSC7BCBK4PH4F1/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M52339NGM8CSC7BCBK4PH4F1","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","iteration":1},"invocation":{"id":"01M52339NG3FY1YQC9G29190D5","source"… |
| H0686: GET /runs/01M52339NGM8CSC7BCBK4PH4F1/events               | 200  | {"items":[{"runId":"01M52339NGM8CSC7BCBK4PH4F1","seq":1,"ts":"2026-10-16T10:11:07.056Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339NGM8CSC7BCBK4PH4F1","loopId":"01M52339KBP1SYNF… |

## W-auth-body

body authentication uses exact UTF-8 bytes

**PASS** — expected: 202 exactly {accepted:true}; async run payload preserved and invocation eventType set

Observed assertion result: {"ack":{"accepted":true},"runId":"01M52339T0F8TNRSZK7Q22QX4Q","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.200Z","eventType":"qa-body"},"first":{"runId":"01M52339T0F8TNRSZK7Q22QX4Q","seq":1,"ts":"2026-10-16T10:11:07.200Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","iteration":1},"invocation":{"id":"01M52339T0P32CENR1CF1763N3","source":"webhook","caller":{"kind":"system","id":"webhook:01M52339MC442G0PXH9ZYKZP7P"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.200Z","eventType":"qa-body"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0687: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0688: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0689: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"queued","itera…  |
| [H0690: GET /runs/01M52339T0F8TNRSZK7Q22QX4Q                     | 200  | {"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"running","iteration":1,"… |
| H0691: GET /runs/01M52339T0F8TNRSZK7Q22QX4Q                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0692: GET /runs/01M52339T0F8TNRSZK7Q22QX4Q/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","iteration":1},"invocation":{"id":"01M52339T0P32CENR1CF1763N3","source"… |
| H0693: GET /runs/01M52339T0F8TNRSZK7Q22QX4Q/events               | 200  | {"items":[{"runId":"01M52339T0F8TNRSZK7Q22QX4Q","seq":1,"ts":"2026-10-16T10:11:07.200Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","loopId":"01M52339M1FXZ39P… |

## W-auth-timestamp

timestamp authentication uses exact UTF-8 bytes

**PASS** — expected: 202 exactly {accepted:true}; async run payload preserved and invocation eventType set

Observed assertion result: {"ack":{"accepted":true},"runId":"01M52339YCAM1TNYQER2K0J7AW","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.340Z","eventType":"qa-timestamp"},"first":{"runId":"01M52339YCAM1TNYQER2K0J7AW","seq":1,"ts":"2026-10-16T10:11:07.340Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339YCAM1TNYQER2K0J7AW","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","iteration":1},"invocation":{"id":"01M52339YCJQJV3D6F96NAPWX7","source":"webhook","caller":{"kind":"system","id":"webhook:01M52339N2EC664DF02QRMTBAA"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:07.340Z","eventType":"qa-timestamp"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0694: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0695: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0696: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"queued","itera…  |
| [H0697: GET /runs/01M52339YCAM1TNYQER2K0J7AW                     | 200  | {"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"running","iteration":1,"… |
| H0698: GET /runs/01M52339YCAM1TNYQER2K0J7AW                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0699: GET /runs/01M52339YCAM1TNYQER2K0J7AW/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M52339YCAM1TNYQER2K0J7AW","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","iteration":1},"invocation":{"id":"01M52339YCJQJV3D6F96NAPWX7","source"… |
| H0700: GET /runs/01M52339YCAM1TNYQER2K0J7AW/events               | 200  | {"items":{"runId":"01M52339YCAM1TNYQER2K0J7AW","seq":1,"ts":"2026-10-16T10:11:07.340Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M52339YCAM1TNYQER2K0J7AW","loopId":"01M52339MP73F7Y6…  |

## W-signature-body-wrong

body: wrong signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0701: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |
| [H0702: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0703: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500  | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |

## W-signature-body-missing

body: missing signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0704: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |
| [H0705: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0706: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500  | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |

## W-signature-body-duplicate

body: duplicate signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0707: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |
| [H0708: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0709: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500  | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |

## W-signature-body-tampered-bytes

body: tampered-bytes signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0710: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |
| [H0711: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0712: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500  | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it… |

## W-signature-timestamp-wrong

timestamp: wrong signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0713: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |
| [H0714: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0715: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500  | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |

## W-signature-timestamp-missing

timestamp: missing signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0716: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |
| [H0717: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0718: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500  | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |

## W-signature-timestamp-duplicate

timestamp: duplicate signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0719: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |
| [H0720: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0721: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500  | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |

## W-signature-timestamp-tampered-bytes

timestamp: tampered-bytes signature

**PASS** — expected: 401 SIGNATURE_INVALID; no new run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0722: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |
| [H0723: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H0724: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500  | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |

## W-timestamp-stale

stale timestamp with valid HMAC

**PASS** — expected: 401 TIMESTAMP_OUT_OF_WINDOW

Observed assertion result: {"type":"https://graphgoblin.dev/problems/timestamp-out-of-window","title":"timestamp out of window","status":401,"code":"TIMESTAMP_OUT_OF_WINDOW","detail":"the delivery timestamp is outside the window"}

| Request                                                         | HTTP | Response excerpt                                                                           |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| [H0725: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo | 401  | {"code":"TIMESTAMP_OUT_OF_WINDOW","detail":"the delivery timestamp is outside the window"} |

## W-timestamp-future

future timestamp with valid HMAC

**PASS** — expected: 401 TIMESTAMP_OUT_OF_WINDOW

Observed assertion result: {"type":"https://graphgoblin.dev/problems/timestamp-out-of-window","title":"timestamp out of window","status":401,"code":"TIMESTAMP_OUT_OF_WINDOW","detail":"the delivery timestamp is outside the window"}

| Request                                                        | HTTP | Response excerpt                                                                           |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| H0726: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo | 401  | {"code":"TIMESTAMP_OUT_OF_WINDOW","detail":"the delivery timestamp is outside the window"} |

## W-timestamp-missing

missing timestamp header

**PASS** — expected: 401 TIMESTAMP_MISSING

Observed assertion result: {"type":"https://graphgoblin.dev/problems/timestamp-missing","title":"timestamp missing","status":401,"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"}

| Request                                                        | HTTP | Response excerpt                                                                                 |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| H0727: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo | 401  | {"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"} |

## W-timestamp-duplicate

duplicate timestamp header

**PASS** — expected: 401 TIMESTAMP_MISSING

Observed assertion result: {"type":"https://graphgoblin.dev/problems/timestamp-missing","title":"timestamp missing","status":401,"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"}

| Request                                                        | HTTP | Response excerpt                                                                                 |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| H0728: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo | 401  | {"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"} |

## W-timestamp-invalid

invalid timestamp header

**PASS** — expected: 401 TIMESTAMP_MISSING

Observed assertion result: {"type":"https://graphgoblin.dev/problems/timestamp-missing","title":"timestamp missing","status":401,"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"}

| Request                                                        | HTTP | Response excerpt                                                                                 |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| H0729: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo | 401  | {"code":"TIMESTAMP_MISSING","detail":"the x-graphgoblin-timestamp header is missing or invalid"} |

## W-timestamp-iso

ISO timestamp authentication

**PASS** — expected: 202 and one run

Observed assertion result: {"status":202,"body":{"accepted":true}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0730: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M52339YCAM1TNYQER2K0J7AW","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M52339YCJQJV3D6F96NAPWX7","status":"succeeded","it… |
| [H0731: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo  | 202  | {"accepted":true}                                                                                                                                                                                                  |
| H0732: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M5233A626CWMK47S3TXKGKTM","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M5233A62576NWXVS2A179C3G","status":"queued","itera… |

## W-json-empty

JSON empty

**PASS** — expected: 400 BODY_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}

| Request                                                         | HTTP | Response excerpt                                                       |
| --------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| [H0733: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4 | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"} |

## W-json-whitespace

JSON whitespace

**PASS** — expected: 400 BODY_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}

| Request                                                        | HTTP | Response excerpt                                                       |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| H0734: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4 | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"} |

## W-json-invalid-json

JSON invalid-json

**PASS** — expected: 400 BODY_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}

| Request                                                        | HTTP | Response excerpt                                                       |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| H0735: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4 | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"} |

## W-json-invalid-utf8

JSON invalid-utf8

**PASS** — expected: 400 BODY_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}

| Request                                                        | HTTP | Response excerpt                                                       |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| H0736: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4 | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"} |

## W-json-null

literal JSON null

**PASS** — expected: 202; null payload retained

Observed assertion result: {"runId":"01M5233A7PEFC1QN3SY60ZTVRP","trigger":{"nodeId":"start","kind":"webhook","payload":null,"receivedAt":"2026-10-16T10:11:07.638Z","eventType":"qa-none"},"first":{"runId":"01M5233A7PEFC1QN3SY60ZTVRP","seq":1,"ts":"2026-10-16T10:11:07.638Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233A7PEFC1QN3SY60ZTVRP","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","iteration":1},"invocation":{"id":"01M5233A7PTEX4NMM4566S4P3Q","source":"webhook","caller":{"kind":"system","id":"webhook:01M52339KPTSXM1NYAFKGMYFJD"},"trigger":{"nodeId":"start","kind":"webhook","payload":null,"receivedAt":"2026-10-16T10:11:07.638Z","eventType":"qa-none"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0737: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":{"id":"01M52339NGM8CSC7BCBK4PH4F1","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M52339NG3FY1YQC9G29190D5","status":"succeeded","it…  |
| [H0738: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0739: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":{"id":"01M5233A7PEFC1QN3SY60ZTVRP","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M5233A7PTEX4NMM4566S4P3Q","status":"queued","itera…  |
| [H0740: GET /runs/01M5233A7PEFC1QN3SY60ZTVRP                     | 200  | {"id":"01M5233A7PEFC1QN3SY60ZTVRP","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M5233A7PTEX4NMM4566S4P3Q","status":"running","iteration":1,"… |
| H0741: GET /runs/01M5233A7PEFC1QN3SY60ZTVRP                      | 200  | {"status":"succeeded","outcome":"success"}                                                                                                                                                                          |
| H0742: GET /runs/01M5233A7PEFC1QN3SY60ZTVRP/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233A7PEFC1QN3SY60ZTVRP","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","iteration":1},"invocation":{"id":"01M5233A7PTEX4NMM4566S4P3Q","source"… |
| H0743: GET /runs/01M5233A7PEFC1QN3SY60ZTVRP/events               | 200  | {"items":[{"runId":"01M5233A7PEFC1QN3SY60ZTVRP","seq":1,"ts":"2026-10-16T10:11:07.638Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233A7PEFC1QN3SY60ZTVRP","loopId":"01M52339KBP1SYNF… |

## W-mode-text

text body mode

**PASS** — expected: 202; decoded payload equals expected representation

Observed assertion result: {"runId":"01M5233ACGWQQH0J6A67F9KHVZ","trigger":{"nodeId":"start","kind":"webhook","payload":"line 1\n café","receivedAt":"2026-10-16T10:11:07.792Z","eventType":"webhook"},"first":{"runId":"01M5233ACGWQQH0J6A67F9KHVZ","seq":1,"ts":"2026-10-16T10:11:07.792Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233ACGWQQH0J6A67F9KHVZ","loopId":"01M5233ABS4ZWA6H5Z4GK4EZYA","versionId":"01M5233ABSRS3DR8SHBYZ2MCZY","iteration":1},"invocation":{"id":"01M5233ACG4PFBWZ22N2WZBQ0W","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AC6TNHWC83SABGKF5X2"},"trigger":{"nodeId":"start","kind":"webhook","payload":"line 1\n café","receivedAt":"2026-10-16T10:11:07.792Z","eventType":"webhook"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0744: POST /loops                                               | 201  | {"loop":{"id":"01M5233ABS4ZWA6H5Z4GK4EZYA"},"draft":{"id":"01M5233ABSRS3DR8SHBYZ2MCZY","schemaVersion":4},"issues":[]}                                                                                              |
| H0745: POST /loops/01M5233ABS4ZWA6H5Z4GK4EZYA/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0746: GET /loops/01M5233ABS4ZWA6H5Z4GK4EZYA/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M5233AC6TNHWC83SABGKF5X2","ownerId":"local","loopId":"01M5233ABS4ZWA6H5Z4GK4EZYA","versionId":"01M5233ABSRS3DR8SHBYZ2MCZY","triggerNodeId":"start","path":"/hooks/zQzCFP4gHL2…  |
| [H0747: POST /hooks/zQzCFP4gHL2UK0jyQwNAsnnJUgByy6YKWtf2CjpXBv4  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0748: GET /runs?loopId=01M5233ABS4ZWA6H5Z4GK4EZYA&amp;limit=500 | 200  | {"items":{"id":"01M5233ACGWQQH0J6A67F9KHVZ","ownerId":"local","loopId":"01M5233ABS4ZWA6H5Z4GK4EZYA","versionId":"01M5233ABSRS3DR8SHBYZ2MCZY","invocationId":"01M5233ACG4PFBWZ22N2WZBQ0W","status":"queued","itera…  |
| [H0749: GET /runs/01M5233ACGWQQH0J6A67F9KHVZ                     | 200  | {"id":"01M5233ACGWQQH0J6A67F9KHVZ","ownerId":"local","loopId":"01M5233ABS4ZWA6H5Z4GK4EZYA","versionId":"01M5233ABSRS3DR8SHBYZ2MCZY","invocationId":"01M5233ACG4PFBWZ22N2WZBQ0W","status":"running","iteration":1,"… |
| H0750: GET /runs/01M5233ACGWQQH0J6A67F9KHVZ                      | 200  | {"status":"succeeded","outcome":"success","result":"line 1\n café"}                                                                                                                                                 |
| H0751: GET /runs/01M5233ACGWQQH0J6A67F9KHVZ/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233ACGWQQH0J6A67F9KHVZ","loopId":"01M5233ABS4ZWA6H5Z4GK4EZYA","versionId":"01M5233ABSRS3DR8SHBYZ2MCZY","iteration":1},"invocation":{"id":"01M5233ACG4PFBWZ22N2WZBQ0W","source"… |
| H0752: GET /runs/01M5233ACGWQQH0J6A67F9KHVZ/events               | 200  | {"items":[{"runId":"01M5233ACGWQQH0J6A67F9KHVZ","seq":1,"ts":"2026-10-16T10:11:07.792Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233ACGWQQH0J6A67F9KHVZ","loopId":"01M5233ABS4ZWA6H… |

## W-mode-text-empty

text-empty body mode

**PASS** — expected: 202; decoded payload equals expected representation

Observed assertion result: {"runId":"01M5233AHBK6QXTNNNCEDFN9FC","trigger":{"nodeId":"start","kind":"webhook","payload":"","receivedAt":"2026-10-16T10:11:07.947Z","eventType":"webhook"},"first":{"runId":"01M5233AHBK6QXTNNNCEDFN9FC","seq":1,"ts":"2026-10-16T10:11:07.947Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233AHBK6QXTNNNCEDFN9FC","loopId":"01M5233AGMAQPZ46PSJTZNVAVH","versionId":"01M5233AGMY6Q8P8KA7QZ8DP19","iteration":1},"invocation":{"id":"01M5233AHBWGBMSGQSA8B9ZPJ7","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AH1T28DP7TSE7RH35SP"},"trigger":{"nodeId":"start","kind":"webhook","payload":"","receivedAt":"2026-10-16T10:11:07.947Z","eventType":"webhook"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0753: POST /loops                                               | 201  | {"loop":{"id":"01M5233AGMAQPZ46PSJTZNVAVH"},"draft":{"id":"01M5233AGMY6Q8P8KA7QZ8DP19","schemaVersion":4},"issues":[]}                                                                                              |
| H0754: POST /loops/01M5233AGMAQPZ46PSJTZNVAVH/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0755: GET /loops/01M5233AGMAQPZ46PSJTZNVAVH/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M5233AH1T28DP7TSE7RH35SP","ownerId":"local","loopId":"01M5233AGMAQPZ46PSJTZNVAVH","versionId":"01M5233AGMY6Q8P8KA7QZ8DP19","triggerNodeId":"start","path":"/hooks/TLcQaobGhoP…  |
| [H0756: POST /hooks/TLcQaobGhoPNbpseURsxwgk2BN0nvJegS83yrxDz1to  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0757: GET /runs?loopId=01M5233AGMAQPZ46PSJTZNVAVH&amp;limit=500 | 200  | {"items":{"id":"01M5233AHBK6QXTNNNCEDFN9FC","ownerId":"local","loopId":"01M5233AGMAQPZ46PSJTZNVAVH","versionId":"01M5233AGMY6Q8P8KA7QZ8DP19","invocationId":"01M5233AHBWGBMSGQSA8B9ZPJ7","status":"queued","itera…  |
| [H0758: GET /runs/01M5233AHBK6QXTNNNCEDFN9FC                     | 200  | {"id":"01M5233AHBK6QXTNNNCEDFN9FC","ownerId":"local","loopId":"01M5233AGMAQPZ46PSJTZNVAVH","versionId":"01M5233AGMY6Q8P8KA7QZ8DP19","invocationId":"01M5233AHBWGBMSGQSA8B9ZPJ7","status":"running","iteration":1,"… |
| H0759: GET /runs/01M5233AHBK6QXTNNNCEDFN9FC                      | 200  | {"status":"succeeded","outcome":"success","result":""}                                                                                                                                                              |
| H0760: GET /runs/01M5233AHBK6QXTNNNCEDFN9FC/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233AHBK6QXTNNNCEDFN9FC","loopId":"01M5233AGMAQPZ46PSJTZNVAVH","versionId":"01M5233AGMY6Q8P8KA7QZ8DP19","iteration":1},"invocation":{"id":"01M5233AHBWGBMSGQSA8B9ZPJ7","source"… |
| H0761: GET /runs/01M5233AHBK6QXTNNNCEDFN9FC/events               | 200  | {"items":[{"runId":"01M5233AHBK6QXTNNNCEDFN9FC","seq":1,"ts":"2026-10-16T10:11:07.947Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233AHBK6QXTNNNCEDFN9FC","loopId":"01M5233AGMAQPZ46… |

## W-mode-bytes

bytes body mode

**PASS** — expected: 202; decoded payload equals expected representation

Observed assertion result: {"runId":"01M5233ANZYQAKXB592DTKBNER","trigger":{"nodeId":"start","kind":"webhook","payload":{"encoding":"base64","data":"AP/DKAo="},"receivedAt":"2026-10-16T10:11:08.095Z","eventType":"webhook"},"first":{"runId":"01M5233ANZYQAKXB592DTKBNER","seq":1,"ts":"2026-10-16T10:11:08.095Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233ANZYQAKXB592DTKBNER","loopId":"01M5233ANB1CWZXH509P5C4W3V","versionId":"01M5233ANBQFVAXJWWCWKQ4TXN","iteration":1},"invocation":{"id":"01M5233ANZ6SDSRQA9FKR0FEMP","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233ANNKVVT7MNFEWYQ1GCJ"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"encoding":"base64","data":"AP/DKAo="},"receivedAt":"2026-10-16T10:11:08.095Z","eventType":"webhook"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0762: POST /loops                                               | 201  | {"loop":{"id":"01M5233ANB1CWZXH509P5C4W3V"},"draft":{"id":"01M5233ANBQFVAXJWWCWKQ4TXN","schemaVersion":4},"issues":[]}                                                                                              |
| H0763: POST /loops/01M5233ANB1CWZXH509P5C4W3V/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0764: GET /loops/01M5233ANB1CWZXH509P5C4W3V/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M5233ANNKVVT7MNFEWYQ1GCJ","ownerId":"local","loopId":"01M5233ANB1CWZXH509P5C4W3V","versionId":"01M5233ANBQFVAXJWWCWKQ4TXN","triggerNodeId":"start","path":"/hooks/iPA_PjJiThV…  |
| [H0765: POST /hooks/iPA_PjJiThVhTpL_CvLidOyoHEBIzHF1RUPGRMC0TIU  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0766: GET /runs?loopId=01M5233ANB1CWZXH509P5C4W3V&amp;limit=500 | 200  | {"items":{"id":"01M5233ANZYQAKXB592DTKBNER","ownerId":"local","loopId":"01M5233ANB1CWZXH509P5C4W3V","versionId":"01M5233ANBQFVAXJWWCWKQ4TXN","invocationId":"01M5233ANZ6SDSRQA9FKR0FEMP","status":"running","iter…  |
| [H0767: GET /runs/01M5233ANZYQAKXB592DTKBNER                     | 200  | {"id":"01M5233ANZYQAKXB592DTKBNER","ownerId":"local","loopId":"01M5233ANB1CWZXH509P5C4W3V","versionId":"01M5233ANBQFVAXJWWCWKQ4TXN","invocationId":"01M5233ANZ6SDSRQA9FKR0FEMP","status":"running","currentNodeId"… |
| H0768: GET /runs/01M5233ANZYQAKXB592DTKBNER                      | 200  | {"status":"succeeded","outcome":"success","result":{"encoding":"base64","data":"AP/DKAo="}}                                                                                                                         |
| H0769: GET /runs/01M5233ANZYQAKXB592DTKBNER/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233ANZYQAKXB592DTKBNER","loopId":"01M5233ANB1CWZXH509P5C4W3V","versionId":"01M5233ANBQFVAXJWWCWKQ4TXN","iteration":1},"invocation":{"id":"01M5233ANZ6SDSRQA9FKR0FEMP","source"… |
| H0770: GET /runs/01M5233ANZYQAKXB592DTKBNER/events               | 200  | {"items":{"runId":"01M5233ANZYQAKXB592DTKBNER","seq":1,"ts":"2026-10-16T10:11:08.095Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233ANZYQAKXB592DTKBNER","loopId":"01M5233ANB1CWZXH…  |

## W-text-invalid-utf8

text mode refuses invalid UTF-8

**PASS** — expected: 400 BODY_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}

| Request                                                         | HTTP | Response excerpt                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0771: POST /loops                                             | 201  | {"loop":{"id":"01M5233AT6EG6HCR7YXMPXH7C2"},"draft":{"id":"01M5233AT6KC04087PC5QG2GC9","schemaVersion":4},"issues":[]}                                                                                             |
| H0772: POST /loops/01M5233AT6EG6HCR7YXMPXH7C2/publish           | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H0773: GET /loops/01M5233AT6EG6HCR7YXMPXH7C2/triggers           | 200  | {"schedules":[],"webhooks":{"id":"01M5233ATH70GFJCTBQB3V88M3","ownerId":"local","loopId":"01M5233AT6EG6HCR7YXMPXH7C2","versionId":"01M5233AT6KC04087PC5QG2GC9","triggerNodeId":"start","path":"/hooks/729AB2AvOdu… |
| [H0774: POST /hooks/729AB2AvOdu9qoI4771raCTisTlFSYliEyQinUBX5m0 | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}                                                                                                                                             |

## W-over-limit

1 MiB + 1 raw bytes

**PASS** — expected: 413 BODY_TOO_LARGE; no run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/body-too-large","title":"body too large","status":413,"code":"BODY_TOO_LARGE","detail":"Request body is too large"}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0775: POST /loops                                               | 201  | {"loop":{"id":"01M5233ATYFKNXE8KTFNAPS1BV"},"draft":{"id":"01M5233ATY6BQKV6JFW2SRV51K","schemaVersion":4},"issues":[]}                                                                                             |
| H0776: POST /loops/01M5233ATYFKNXE8KTFNAPS1BV/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H0777: GET /loops/01M5233ATYFKNXE8KTFNAPS1BV/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M5233AV9WEK032JKD44Y5AAJ","ownerId":"local","loopId":"01M5233ATYFKNXE8KTFNAPS1BV","versionId":"01M5233ATY6BQKV6JFW2SRV51K","triggerNodeId":"start","path":"/hooks/HLwuximTZ1t… |
| [H0778: POST /hooks/HLwuximTZ1tigCXYG0S-WThdanYONWQYD5dBEde772E  | 413  | {"code":"BODY_TOO_LARGE","detail":"Request body is too large"}                                                                                                                                                     |
| H0779: GET /runs?loopId=01M5233ATYFKNXE8KTFNAPS1BV&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## W-event-header-selected

header event selected

**PASS** — expected: 202; invocation.trigger.eventType=issue-opened

Observed assertion result: {"runId":"01M5233AWGF2BTT33H491NCPHK","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.304Z","eventType":"issue-opened"},"first":{"runId":"01M5233AWGF2BTT33H491NCPHK","seq":1,"ts":"2026-10-16T10:11:08.304Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233AWGF2BTT33H491NCPHK","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233AWG17XCFS89BXQGCGRP","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AW4CGAQE6J7MV1EPA6B"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.304Z","eventType":"issue-opened"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0783: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0784: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0785: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233AWGF2BTT33H491NCPHK","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233AWG17XCFS89BXQGCGRP","status":"queued","itera…  |
| [H0786: GET /runs/01M5233AWGF2BTT33H491NCPHK                     | 200  | {"id":"01M5233AWGF2BTT33H491NCPHK","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233AWG17XCFS89BXQGCGRP","status":"running","iteration":1,"… |
| H0787: GET /runs/01M5233AWGF2BTT33H491NCPHK                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0788: GET /runs/01M5233AWGF2BTT33H491NCPHK/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233AWGF2BTT33H491NCPHK","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233AWG17XCFS89BXQGCGRP","source"… |
| H0789: GET /runs/01M5233AWGF2BTT33H491NCPHK/events               | 200  | {"items":[{"runId":"01M5233AWGF2BTT33H491NCPHK","seq":1,"ts":"2026-10-16T10:11:08.304Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233AWGF2BTT33H491NCPHK","loopId":"01M5233AVT361GCV… |

## W-event-header-absent

header event absent

**PASS** — expected: 202; invocation.trigger.eventType=qa-fallback

Observed assertion result: {"runId":"01M5233B0MM20E7TXZZX11KTQM","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.436Z","eventType":"qa-fallback"},"first":{"runId":"01M5233B0MM20E7TXZZX11KTQM","seq":1,"ts":"2026-10-16T10:11:08.436Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B0MM20E7TXZZX11KTQM","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B0M99E4V5HYY74NT1F8","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AW4CGAQE6J7MV1EPA6B"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.436Z","eventType":"qa-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0790: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233AWGF2BTT33H491NCPHK","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233AWG17XCFS89BXQGCGRP","status":"succeeded","it…  |
| [H0791: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0792: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233B0MM20E7TXZZX11KTQM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B0M99E4V5HYY74NT1F8","status":"queued","itera…  |
| [H0793: GET /runs/01M5233B0MM20E7TXZZX11KTQM                     | 200  | {"id":"01M5233B0MM20E7TXZZX11KTQM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B0M99E4V5HYY74NT1F8","status":"running","iteration":1,"… |
| H0794: GET /runs/01M5233B0MM20E7TXZZX11KTQM                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0795: GET /runs/01M5233B0MM20E7TXZZX11KTQM/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233B0MM20E7TXZZX11KTQM","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B0M99E4V5HYY74NT1F8","source"… |
| H0796: GET /runs/01M5233B0MM20E7TXZZX11KTQM/events               | 200  | {"items":[{"runId":"01M5233B0MM20E7TXZZX11KTQM","seq":1,"ts":"2026-10-16T10:11:08.436Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B0MM20E7TXZZX11KTQM","loopId":"01M5233AVT361GCV… |

## W-event-header-blank

header event blank

**PASS** — expected: 202; invocation.trigger.eventType=qa-fallback

Observed assertion result: {"runId":"01M5233B4TJAM57GFMHS9C1QNM","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.570Z","eventType":"qa-fallback"},"first":{"runId":"01M5233B4TJAM57GFMHS9C1QNM","seq":1,"ts":"2026-10-16T10:11:08.570Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B4TJAM57GFMHS9C1QNM","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B4T66DP8YY4CS96C4FC","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AW4CGAQE6J7MV1EPA6B"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.570Z","eventType":"qa-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0797: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233B0MM20E7TXZZX11KTQM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B0M99E4V5HYY74NT1F8","status":"succeeded","it…  |
| [H0798: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0799: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233B4TJAM57GFMHS9C1QNM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B4T66DP8YY4CS96C4FC","status":"queued","itera…  |
| [H0800: GET /runs/01M5233B4TJAM57GFMHS9C1QNM                     | 200  | {"id":"01M5233B4TJAM57GFMHS9C1QNM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B4T66DP8YY4CS96C4FC","status":"running","currentNodeId"… |
| H0801: GET /runs/01M5233B4TJAM57GFMHS9C1QNM                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0802: GET /runs/01M5233B4TJAM57GFMHS9C1QNM/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233B4TJAM57GFMHS9C1QNM","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B4T66DP8YY4CS96C4FC","source"… |
| H0803: GET /runs/01M5233B4TJAM57GFMHS9C1QNM/events               | 200  | {"items":{"runId":"01M5233B4TJAM57GFMHS9C1QNM","seq":1,"ts":"2026-10-16T10:11:08.570Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B4TJAM57GFMHS9C1QNM","loopId":"01M5233AVT361GCV…  |

## W-event-header-ambiguous

header event ambiguous

**PASS** — expected: 400 EVENT_TYPE_AMBIGUOUS

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-ambiguous","title":"event type ambiguous","status":400,"code":"EVENT_TYPE_AMBIGUOUS","detail":"the event type header is ambiguous"}

| Request                                                         | HTTP | Response excerpt                                                              |
| --------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| [H0811: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ | 400  | {"code":"EVENT_TYPE_AMBIGUOUS","detail":"the event type header is ambiguous"} |

## W-event-header-comma

header event comma

**PASS** — expected: 202; invocation.trigger.eventType=one,two

Observed assertion result: {"runId":"01M5233B95GPKX3PWEJF4Y19X9","trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.709Z","eventType":"one,two"},"first":{"runId":"01M5233B95GPKX3PWEJF4Y19X9","seq":1,"ts":"2026-10-16T10:11:08.709Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B95GPKX3PWEJF4Y19X9","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B95HSP1NXKR1TKBE615","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233AW4CGAQE6J7MV1EPA6B"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"message":"café 🌳","n":7},"receivedAt":"2026-10-16T10:11:08.709Z","eventType":"one,two"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0804: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233B4TJAM57GFMHS9C1QNM","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B4T66DP8YY4CS96C4FC","status":"succeeded","it…  |
| [H0805: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0806: GET /runs?loopId=01M5233AVT361GCVFV439JY7F1&amp;limit=500 | 200  | {"items":{"id":"01M5233B95GPKX3PWEJF4Y19X9","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B95HSP1NXKR1TKBE615","status":"queued","itera…  |
| [H0807: GET /runs/01M5233B95GPKX3PWEJF4Y19X9                     | 200  | {"id":"01M5233B95GPKX3PWEJF4Y19X9","ownerId":"local","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","invocationId":"01M5233B95HSP1NXKR1TKBE615","status":"running","iteration":1,"… |
| H0808: GET /runs/01M5233B95GPKX3PWEJF4Y19X9                      | 200  | {"status":"succeeded","outcome":"success","result":{"message":"café 🌳","n":7}}                                                                                                                                     |
| H0809: GET /runs/01M5233B95GPKX3PWEJF4Y19X9/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233B95GPKX3PWEJF4Y19X9","loopId":"01M5233AVT361GCVFV439JY7F1","versionId":"01M5233AVTXH0X68WDSWAG235Y","iteration":1},"invocation":{"id":"01M5233B95HSP1NXKR1TKBE615","source"… |
| H0810: GET /runs/01M5233B95GPKX3PWEJF4Y19X9/events               | 200  | {"items":{"runId":"01M5233B95GPKX3PWEJF4Y19X9","seq":1,"ts":"2026-10-16T10:11:08.709Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233B95GPKX3PWEJF4Y19X9","loopId":"01M5233AVT361GCV…  |

## W-event-header-control

header event control

**PASS** — expected: 422 EVENT_TYPE_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-invalid","title":"event type invalid","status":422,"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"}

| Request                                                         | HTTP | Response excerpt                                                   |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| [H0812: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ | 422  | {"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"} |

## W-event-header-overlong

header event overlong

**PASS** — expected: 422 EVENT_TYPE_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-invalid","title":"event type invalid","status":422,"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"}

| Request                                                        | HTTP | Response excerpt                                                   |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| H0813: POST /hooks/PyNfeFJhFM-tAiz1C_TiOZyaPu1h457JiB2NbXzjBPQ | 422  | {"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"} |

## W-event-pointer-selected

pointer event selected

**PASS** — expected: 202; eventType=issue-ready

Observed assertion result: {"runId":"01M5233BEFZCJNKX2GTZRZA322","trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":"issue-ready"}},"receivedAt":"2026-10-16T10:11:08.879Z","eventType":"issue-ready"},"first":{"runId":"01M5233BEFZCJNKX2GTZRZA322","seq":1,"ts":"2026-10-16T10:11:08.879Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BEFZCJNKX2GTZRZA322","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BEFZMQMGKZGBAD5H3ZR","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":"issue-ready"}},"receivedAt":"2026-10-16T10:11:08.879Z","eventType":"issue-ready"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0817: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0818: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0819: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BEFZCJNKX2GTZRZA322","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BEFZMQMGKZGBAD5H3ZR","status":"running","iter…  |
| [H0820: GET /runs/01M5233BEFZCJNKX2GTZRZA322                     | 200  | {"id":"01M5233BEFZCJNKX2GTZRZA322","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BEFZMQMGKZGBAD5H3ZR","status":"running","currentNodeId"… |
| H0821: GET /runs/01M5233BEFZCJNKX2GTZRZA322                      | 200  | {"status":"succeeded","outcome":"success","result":{"meta":{"type":"issue-ready"}}}                                                                                                                                 |
| H0822: GET /runs/01M5233BEFZCJNKX2GTZRZA322/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233BEFZCJNKX2GTZRZA322","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BEFZMQMGKZGBAD5H3ZR","source"… |
| H0823: GET /runs/01M5233BEFZCJNKX2GTZRZA322/events               | 200  | {"items":[{"runId":"01M5233BEFZCJNKX2GTZRZA322","seq":1,"ts":"2026-10-16T10:11:08.879Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BEFZCJNKX2GTZRZA322","loopId":"01M5233BDSTMBB0G… |

## W-event-pointer-missing

pointer event missing

**PASS** — expected: 202; eventType=qa-pointer-fallback

Observed assertion result: {"runId":"01M5233BJXRSR89E0CBKEESYDS","trigger":{"nodeId":"start","kind":"webhook","payload":{},"receivedAt":"2026-10-16T10:11:09.021Z","eventType":"qa-pointer-fallback"},"first":{"runId":"01M5233BJXRSR89E0CBKEESYDS","seq":1,"ts":"2026-10-16T10:11:09.021Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BJXRSR89E0CBKEESYDS","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BJXRV9NRAXWZQTGTRDV","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{},"receivedAt":"2026-10-16T10:11:09.021Z","eventType":"qa-pointer-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0824: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BEFZCJNKX2GTZRZA322","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BEFZMQMGKZGBAD5H3ZR","status":"succeeded","it…  |
| [H0825: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0826: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BJXRSR89E0CBKEESYDS","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BJXRV9NRAXWZQTGTRDV","status":"queued","itera…  |
| [H0827: GET /runs/01M5233BJXRSR89E0CBKEESYDS                     | 200  | {"id":"01M5233BJXRSR89E0CBKEESYDS","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BJXRV9NRAXWZQTGTRDV","status":"running","iteration":1,"… |
| H0828: GET /runs/01M5233BJXRSR89E0CBKEESYDS                      | 200  | {"status":"succeeded","outcome":"success","result":{}}                                                                                                                                                              |
| H0829: GET /runs/01M5233BJXRSR89E0CBKEESYDS/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233BJXRSR89E0CBKEESYDS","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BJXRV9NRAXWZQTGTRDV","source"… |
| H0830: GET /runs/01M5233BJXRSR89E0CBKEESYDS/events               | 200  | {"items":[{"runId":"01M5233BJXRSR89E0CBKEESYDS","seq":1,"ts":"2026-10-16T10:11:09.021Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BJXRSR89E0CBKEESYDS","loopId":"01M5233BDSTMBB0G… |

## W-event-pointer-object

pointer event object

**PASS** — expected: 202; eventType=qa-pointer-fallback

Observed assertion result: {"runId":"01M5233BQ5C6J3K1HZJ94TNTDJ","trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":{"x":1}}},"receivedAt":"2026-10-16T10:11:09.157Z","eventType":"qa-pointer-fallback"},"first":{"runId":"01M5233BQ5C6J3K1HZJ94TNTDJ","seq":1,"ts":"2026-10-16T10:11:09.157Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BQ5XC3Q42PX9ZA523NW","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":{"x":1}}},"receivedAt":"2026-10-16T10:11:09.157Z","eventType":"qa-pointer-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0831: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BJXRSR89E0CBKEESYDS","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BJXRV9NRAXWZQTGTRDV","status":"succeeded","it…  |
| [H0832: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0833: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BQ5XC3Q42PX9ZA523NW","status":"queued","itera…  |
| [H0834: GET /runs/01M5233BQ5C6J3K1HZJ94TNTDJ                     | 200  | {"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BQ5XC3Q42PX9ZA523NW","status":"running","currentNodeId"… |
| H0835: GET /runs/01M5233BQ5C6J3K1HZJ94TNTDJ                      | 200  | {"status":"succeeded","outcome":"success","result":{"meta":{"type":{"x":1}}}}                                                                                                                                       |
| H0836: GET /runs/01M5233BQ5C6J3K1HZJ94TNTDJ/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BQ5XC3Q42PX9ZA523NW","source"… |
| H0837: GET /runs/01M5233BQ5C6J3K1HZJ94TNTDJ/events               | 200  | {"items":[{"runId":"01M5233BQ5C6J3K1HZJ94TNTDJ","seq":1,"ts":"2026-10-16T10:11:09.157Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","loopId":"01M5233BDSTMBB0G… |

## W-event-pointer-null

pointer event null

**PASS** — expected: 202; eventType=qa-pointer-fallback

Observed assertion result: {"runId":"01M5233BVGJD1ST908BD5E0WW4","trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":null}},"receivedAt":"2026-10-16T10:11:09.296Z","eventType":"qa-pointer-fallback"},"first":{"runId":"01M5233BVGJD1ST908BD5E0WW4","seq":1,"ts":"2026-10-16T10:11:09.296Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BVGJD1ST908BD5E0WW4","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BVGAQZMSSR12H0M56BS","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":null}},"receivedAt":"2026-10-16T10:11:09.296Z","eventType":"qa-pointer-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0838: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BQ5C6J3K1HZJ94TNTDJ","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BQ5XC3Q42PX9ZA523NW","status":"succeeded","it…  |
| [H0839: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0840: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BVGJD1ST908BD5E0WW4","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BVGAQZMSSR12H0M56BS","status":"queued","itera…  |
| [H0841: GET /runs/01M5233BVGJD1ST908BD5E0WW4                     | 200  | {"id":"01M5233BVGJD1ST908BD5E0WW4","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BVGAQZMSSR12H0M56BS","status":"running","iteration":1,"… |
| H0842: GET /runs/01M5233BVGJD1ST908BD5E0WW4                      | 200  | {"status":"succeeded","outcome":"success","result":{"meta":{"type":null}}}                                                                                                                                          |
| H0843: GET /runs/01M5233BVGJD1ST908BD5E0WW4/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233BVGJD1ST908BD5E0WW4","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BVGAQZMSSR12H0M56BS","source"… |
| H0844: GET /runs/01M5233BVGJD1ST908BD5E0WW4/events               | 200  | {"items":[{"runId":"01M5233BVGJD1ST908BD5E0WW4","seq":1,"ts":"2026-10-16T10:11:09.296Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BVGJD1ST908BD5E0WW4","loopId":"01M5233BDSTMBB0G… |

## W-event-pointer-number

pointer event number

**PASS** — expected: 202; eventType=42

Observed assertion result: {"runId":"01M5233BZWP1WW6MXRN8CENTK7","trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":42}},"receivedAt":"2026-10-16T10:11:09.436Z","eventType":"42"},"first":{"runId":"01M5233BZWP1WW6MXRN8CENTK7","seq":1,"ts":"2026-10-16T10:11:09.436Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BZWP1WW6MXRN8CENTK7","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BZWS1Y46KBRA1ERXPVM","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":42}},"receivedAt":"2026-10-16T10:11:09.436Z","eventType":"42"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0845: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BVGJD1ST908BD5E0WW4","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BVGAQZMSSR12H0M56BS","status":"succeeded","it…  |
| [H0846: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0847: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BZWP1WW6MXRN8CENTK7","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BZWS1Y46KBRA1ERXPVM","status":"queued","itera…  |
| [H0848: GET /runs/01M5233BZWP1WW6MXRN8CENTK7                     | 200  | {"id":"01M5233BZWP1WW6MXRN8CENTK7","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BZWS1Y46KBRA1ERXPVM","status":"running","iteration":1,"… |
| H0849: GET /runs/01M5233BZWP1WW6MXRN8CENTK7                      | 200  | {"status":"succeeded","outcome":"success","result":{"meta":{"type":42}}}                                                                                                                                            |
| H0850: GET /runs/01M5233BZWP1WW6MXRN8CENTK7/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233BZWP1WW6MXRN8CENTK7","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233BZWS1Y46KBRA1ERXPVM","source"… |
| H0851: GET /runs/01M5233BZWP1WW6MXRN8CENTK7/events               | 200  | {"items":[{"runId":"01M5233BZWP1WW6MXRN8CENTK7","seq":1,"ts":"2026-10-16T10:11:09.436Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233BZWP1WW6MXRN8CENTK7","loopId":"01M5233BDSTMBB0G… |

## W-event-pointer-blank

pointer event blank

**PASS** — expected: 202; eventType=qa-pointer-fallback

Observed assertion result: {"runId":"01M5233C440D6ZK74AD7EMRK0T","trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":""}},"receivedAt":"2026-10-16T10:11:09.572Z","eventType":"qa-pointer-fallback"},"first":{"runId":"01M5233C440D6ZK74AD7EMRK0T","seq":1,"ts":"2026-10-16T10:11:09.572Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233C440D6ZK74AD7EMRK0T","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233C44QS55Z9S5CM69QNKQ","source":"webhook","caller":{"kind":"system","id":"webhook:01M5233BE4N1751E6F20FJ5R75"},"trigger":{"nodeId":"start","kind":"webhook","payload":{"meta":{"type":""}},"receivedAt":"2026-10-16T10:11:09.572Z","eventType":"qa-pointer-fallback"}},"messages":[],"vars":{},"artifacts":[],"outputs":{},"gates":{},"counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0852: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233BZWP1WW6MXRN8CENTK7","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233BZWS1Y46KBRA1ERXPVM","status":"succeeded","it…  |
| [H0853: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0854: GET /runs?loopId=01M5233BDSTMBB0G1TTBYFBZ4V&amp;limit=500 | 200  | {"items":{"id":"01M5233C440D6ZK74AD7EMRK0T","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233C44QS55Z9S5CM69QNKQ","status":"running","iter…  |
| [H0855: GET /runs/01M5233C440D6ZK74AD7EMRK0T                     | 200  | {"id":"01M5233C440D6ZK74AD7EMRK0T","ownerId":"local","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","invocationId":"01M5233C44QS55Z9S5CM69QNKQ","status":"running","currentNodeId"… |
| H0856: GET /runs/01M5233C440D6ZK74AD7EMRK0T                      | 200  | {"status":"succeeded","outcome":"success","result":{"meta":{"type":""}}}                                                                                                                                            |
| H0857: GET /runs/01M5233C440D6ZK74AD7EMRK0T/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233C440D6ZK74AD7EMRK0T","loopId":"01M5233BDSTMBB0G1TTBYFBZ4V","versionId":"01M5233BDSDWWC9HQDZ0RT64E4","iteration":1},"invocation":{"id":"01M5233C44QS55Z9S5CM69QNKQ","source"… |
| H0858: GET /runs/01M5233C440D6ZK74AD7EMRK0T/events               | 200  | {"items":{"runId":"01M5233C440D6ZK74AD7EMRK0T","seq":1,"ts":"2026-10-16T10:11:09.572Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M5233C440D6ZK74AD7EMRK0T","loopId":"01M5233BDSTMBB0G…  |

## W-event-pointer-control

pointer event control

**PASS** — expected: 422 EVENT_TYPE_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-invalid","title":"event type invalid","status":422,"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"}

| Request                                                         | HTTP | Response excerpt                                                   |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| [H0859: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY | 422  | {"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"} |

## W-event-pointer-blank-control

pointer event blank-control

**PASS** — expected: 422 EVENT_TYPE_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-invalid","title":"event type invalid","status":422,"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"}

| Request                                                        | HTTP | Response excerpt                                                   |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| H0860: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY | 422  | {"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"} |

## W-event-pointer-overlong

pointer event overlong

**PASS** — expected: 422 EVENT_TYPE_INVALID

Observed assertion result: {"type":"https://graphgoblin.dev/problems/event-type-invalid","title":"event type invalid","status":422,"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"}

| Request                                                        | HTTP | Response excerpt                                                   |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| H0861: POST /hooks/YVNGcszD5ZKRk7PRFP82tulWFumKSGQM7r_7FZ_SAkY | 422  | {"code":"EVENT_TYPE_INVALID","detail":"the event type is invalid"} |

## W-Allow-none

none identical unkeyed delivery Allow

**PASS** — expected: two 202 acknowledgements; two distinct runs

Observed assertion result: {"acknowledgements":[{"accepted":true},{"accepted":true}],"runIds":["01M5233C992Q85BD9WZJK9D49D","01M5233C8WNYG2YM6CJ5Q138R7"]}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0862: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":{"id":"01M5233A7PEFC1QN3SY60ZTVRP","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M5233A7PTEX4NMM4566S4P3Q","status":"succeeded","it…  |
| [H0863: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0864: POST /hooks/3CLY4uA7MLEg9qedJ1gJPLXi1qS2KcVk_2LJfityUU4   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0865: GET /runs?loopId=01M52339KBP1SYNFPPGR7K6A5M&amp;limit=500 | 200  | {"items":[{"id":"01M5233C992Q85BD9WZJK9D49D","ownerId":"local","loopId":"01M52339KBP1SYNFPPGR7K6A5M","versionId":"01M52339KBKJW8DBJRZKXE501W","invocationId":"01M5233C99R2P2HT56MQPZQT0P","status":"queued","itera… |

## W-Allow-body

body identical unkeyed delivery Allow

**PASS** — expected: two 202 acknowledgements; two distinct runs

Observed assertion result: {"acknowledgements":[{"accepted":true},{"accepted":true}],"runIds":["01M5233CB5YV7MP71Y1BRZJQ81","01M5233CAJXCTB09YX38DS887V"]}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0866: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":{"id":"01M52339T0F8TNRSZK7Q22QX4Q","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M52339T0P32CENR1CF1763N3","status":"succeeded","it…  |
| [H0867: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0868: POST /hooks/ty4dB404EsJF4PWRU55chXXUCoF66pJCSxaYomdRebY   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0869: GET /runs?loopId=01M52339M1FXZ39PCRVS3CNRV5&amp;limit=500 | 200  | {"items":[{"id":"01M5233CB5YV7MP71Y1BRZJQ81","ownerId":"local","loopId":"01M52339M1FXZ39PCRVS3CNRV5","versionId":"01M52339M1CEC80989FEV34EX6","invocationId":"01M5233CB542VNCQ0VVVVGEKWV","status":"queued","itera… |

## W-Allow-timestamp

timestamp identical unkeyed delivery Allow

**PASS** — expected: two 202 acknowledgements; two distinct runs

Observed assertion result: {"acknowledgements":[{"accepted":true},{"accepted":true}],"runIds":["01M5233CDE3CSZ1HAW91CR95N7","01M5233CCNS2F1NAX0MNKRBXE5"]}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0870: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M5233A626CWMK47S3TXKGKTM","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M5233A62576NWXVS2A179C3G","status":"succeeded","it… |
| [H0871: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo  | 202  | {"accepted":true}                                                                                                                                                                                                  |
| H0872: POST /hooks/ue1Vxr2HvHYKvfQwqnHuHAxIPYwhVO2HS6eQXz-Yjpo   | 202  | {"accepted":true}                                                                                                                                                                                                  |
| H0873: GET /runs?loopId=01M52339MP73F7Y6MVJTYCFZ42&amp;limit=500 | 200  | {"items":{"id":"01M5233CDE3CSZ1HAW91CR95N7","ownerId":"local","loopId":"01M52339MP73F7Y6MVJTYCFZ42","versionId":"01M52339MPMW6BNRZAW8RA20DZ","invocationId":"01M5233CDEFSNJKVBD4JY78DSG","status":"queued","itera… |

## W-key-none-empty

none explicit empty key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":0}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0883: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0884: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |
| [H0885: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0886: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0887: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |

## W-key-none-null

none explicit null key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":null}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0888: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0889: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |
| [H0890: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0891: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0892: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |

## W-key-none-513

none explicit 513 key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":513}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0893: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0894: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |
| [H0895: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0896: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0897: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId… |

## W-key-none-512

none explicit 512 key

**PASS** — expected: 202; one run with exact 512-character key

Observed assertion result: {"status":202,"body":{"accepted":true},"keyLength":512}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0898: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0899: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CDB2FD1X7ZVGPCCY68P","ownerId":"local","type":"webhook","payload":{"message":"café 🌳","n":7},"source":"webhook:01M52339N2EC664DF02QRMTBAA","receivedAt":"2026-10-16T10:11:09.862Z","runId…  |
| [H0900: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0901: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":{"id":"01M5233CQCTG6MTRH36V5HQFTM","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233CQCNX6BXEZT49HCNT49","status":"running","iter…  |
| [H0902: GET /runs/01M5233CQCTG6MTRH36V5HQFTM/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233CQCTG6MTRH36V5HQFTM","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","iteration":1},"invocation":{"id":"01M5233CQCNX6BXEZT49HCNT49","source"… |

## W-key-body-empty

body explicit empty key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":0}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0903: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0904: GET /events?limit=200                                     | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0905: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs  | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0906: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0907: GET /events?limit=200                                     | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-body-null

body explicit null key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":null}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0908: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0909: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0910: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0911: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0912: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-body-513

body explicit 513 key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":513}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0913: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0914: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0915: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0916: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0917: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-body-512

body explicit 512 key

**PASS** — expected: 202; one run with exact 512-character key

Observed assertion result: {"status":202,"body":{"accepted":true},"keyLength":512}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0918: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0919: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CQC1FJ6NNQCX2613E30","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk…  |
| [H0920: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0921: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":{"id":"01M5233CZ2N3C6A950NB8GZSNZ","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233CZ2QV13HZVWGQAZ1RKY","status":"running","iter…  |
| [H0922: GET /runs/01M5233CZ2N3C6A950NB8GZSNZ/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233CZ2N3C6A950NB8GZSNZ","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","iteration":1},"invocation":{"id":"01M5233CZ2QV13HZVWGQAZ1RKY","source"… |

## W-key-timestamp-empty

timestamp explicit empty key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":0}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0923: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0924: GET /events?limit=200                                     | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0925: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo  | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0926: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0927: GET /events?limit=200                                     | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-timestamp-null

timestamp explicit null key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":null}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0928: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0929: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0930: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0931: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0932: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-timestamp-513

timestamp explicit 513 key

**PASS** — expected: 422 KEY_INVALID; no receipt or run

Observed assertion result: {"status":422,"body":{"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"},"keyLength":513}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [H0933: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0934: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |
| [H0935: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo   | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                      |
| H0936: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500  | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |
| H0937: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk… |

## W-key-timestamp-512

timestamp explicit 512 key

**PASS** — expected: 202; one run with exact 512-character key

Observed assertion result: {"status":202,"body":{"accepted":true},"keyLength":512}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0938: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H0939: GET /events?limit=200                                      | 200  | {"items":{"id":"01M5233CZ12M24DNRT2RMMSZ4S","ownerId":"local","type":"webhook","payload":{"key":"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk…  |
| [H0940: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0941: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500  | 200  | {"items":{"id":"01M5233D6YSGXKY0G3HN6TKA7B","ownerId":"local","loopId":"01M5233CG987F4NJ7BR3YWDQ7D","versionId":"01M5233CG9Q770AZTPAJ9X915V","invocationId":"01M5233D6YRWB1ZSDA85EQF2JG","status":"running","iter…  |
| [H0942: GET /runs/01M5233D6YSGXKY0G3HN6TKA7B/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M5233D6YSGXKY0G3HN6TKA7B","loopId":"01M5233CG987F4NJ7BR3YWDQ7D","versionId":"01M5233CG9Q770AZTPAJ9X915V","iteration":1},"invocation":{"id":"01M5233D6YRWB1ZSDA85EQF2JG","source"… |

## W-key-repeat-none

none explicit key repeat

**PASS** — expected: both 202; one new run; admitted and deduplicated private receipts

Observed assertion result: [{"id":"01M5233D8H06FCJ7R3FSP0PBDF","delivery":{"state":"deduplicated","attempts":0},"runIds":[]},{"id":"01M5233D84VPD8GFST38ZPDT2P","delivery":{"state":"admitted","attempts":0},"runIds":["01M5233D84D033CP0QP2XCZ0Q0"]}]

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0943: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":{"id":"01M5233CQCTG6MTRH36V5HQFTM","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233CQCNX6BXEZT49HCNT49","status":"succeeded","it…  |
| [H0944: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0945: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0946: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":{"id":"01M5233D84D033CP0QP2XCZ0Q0","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233D845PD1KEQBEMCMC0A4","status":"running","curr…  |
| [H0947: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":{"id":"01M5233D84D033CP0QP2XCZ0Q0","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233D845PD1KEQBEMCMC0A4","status":"succeeded","it…  |
| [H0948: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M5233D8H06FCJ7R3FSP0PBDF","ownerId":"local","type":"webhook","payload":{"key":"permanent-business-key"},"dedupeKey":"permanent-business-key","source":"webhook:01M5233CF9MWCKDTNYN5ZZYTQW","rec… |

## W-key-repeat-body

body explicit key repeat

**PASS** — expected: both 202; one new run; admitted and deduplicated private receipts

Observed assertion result: [{"id":"01M5233DH2CNJ3TKYWW739NGWV","delivery":{"state":"deduplicated","attempts":0},"runIds":[]},{"id":"01M5233DGN9Q35B75YKP6B5MNJ","delivery":{"state":"admitted","attempts":0},"runIds":["01M5233DGNG52M2VY766S7GCPQ"]}]

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0949: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":{"id":"01M5233CZ2N3C6A950NB8GZSNZ","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233CZ2QV13HZVWGQAZ1RKY","status":"succeeded","it…  |
| [H0950: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0951: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0952: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":{"id":"01M5233DGNG52M2VY766S7GCPQ","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233DGNV5ZYJTB24G4PQPSV","status":"running","curr…  |
| [H0953: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":{"id":"01M5233DGNG52M2VY766S7GCPQ","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233DGNV5ZYJTB24G4PQPSV","status":"succeeded","it…  |
| [H0954: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M5233DH2CNJ3TKYWW739NGWV","ownerId":"local","type":"webhook","payload":{"key":"permanent-business-key"},"dedupeKey":"permanent-business-key","source":"webhook:01M5233CFZJN3079P5XHBTZKCS","rec… |

## W-key-repeat-timestamp

timestamp explicit key repeat

**PASS** — expected: both 202; one new run; admitted and deduplicated private receipts

Observed assertion result: [{"id":"01M5233DS7RETH0YXC9TMND1QR","delivery":{"state":"deduplicated","attempts":0},"runIds":[]},{"id":"01M5233DRWTZRJ3R9QT7RS8TFF","delivery":{"state":"admitted","attempts":0},"runIds":["01M5233DRWXZCHVTNRYEADND51"]}]

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H0955: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500  | 200  | {"items":{"id":"01M5233D6YSGXKY0G3HN6TKA7B","ownerId":"local","loopId":"01M5233CG987F4NJ7BR3YWDQ7D","versionId":"01M5233CG9Q770AZTPAJ9X915V","invocationId":"01M5233D6YRWB1ZSDA85EQF2JG","status":"succeeded","it… |
| [H0956: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo   | 202  | {"accepted":true}                                                                                                                                                                                                  |
| H0957: POST /hooks/pLX4AIvk8m3RZtGRW9Z-MT0VfdCrhU9PuNeoazbEjlo    | 202  | {"accepted":true}                                                                                                                                                                                                  |
| H0958: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500  | 200  | {"items":{"id":"01M5233DRWXZCHVTNRYEADND51","ownerId":"local","loopId":"01M5233CG987F4NJ7BR3YWDQ7D","versionId":"01M5233CG9Q770AZTPAJ9X915V","invocationId":"01M5233DRWS4AC8RQSBTDTEVZH","status":"running","curr… |
| [H0959: GET /runs?loopId=01M5233CG987F4NJ7BR3YWDQ7D&amp;limit=500 | 200  | {"items":{"id":"01M5233DRWXZCHVTNRYEADND51","ownerId":"local","loopId":"01M5233CG987F4NJ7BR3YWDQ7D","versionId":"01M5233CG9Q770AZTPAJ9X915V","invocationId":"01M5233DRWS4AC8RQSBTDTEVZH","status":"succeeded","it… |
| [H0960: GET /events?limit=200                                     | 200  | {"items":{"id":"01M5233DS7RETH0YXC9TMND1QR","ownerId":"local","type":"webhook","payload":{"key":"permanent-business-key"},"dedupeKey":"permanent-business-key","source":"webhook:01M5233CGKRRCNYZS7J44KATZ0","rec… |

## W-key-permanent

explicit key survives version and authentication recipe change

**PASS** — expected: stable endpoint token; new version body HMAC repeat 202 deduplicated; no new run

Observed assertion result: {"ack":{"accepted":true},"oldVersion":"01M5233CED105JS9QW9FB5XETR","newVersion":"01M5233E15JF4JN42K19X76ARQ","runs":2,"latestReceipt":{"state":"deduplicated","attempts":0}}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H0961: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500 | 200  | {"items":{"id":"01M5233D84D033CP0QP2XCZ0Q0","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233D845PD1KEQBEMCMC0A4","status":"succeeded","it…  |
| [H0962: GET /loops/01M5233CEDHHKYVZGG7KXGEVFA                     | 200  | {"loop":{"id":"01M5233CEDHHKYVZGG7KXGEVFA","currentVersionId":"01M5233CED105JS9QW9FB5XETR"},"draft":{}}                                                                                                             |
| H0963: PUT /loops/01M5233CEDHHKYVZGG7KXGEVFA/draft                | 200  | {"draft":{"id":"01M5233E15JF4JN42K19X76ARQ","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","version":2,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145466966 key none","description":"New version cha… |
| H0964: POST /loops/01M5233CEDHHKYVZGG7KXGEVFA/publish             | 200  | {"version":2,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0965: GET /loops/01M5233CEDHHKYVZGG7KXGEVFA/triggers             | 200  | {"schedules":[],"webhooks":{"id":"01M5233E1FRDCFXS7AXQ5NZNNZ","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233E15JF4JN42K19X76ARQ","triggerNodeId":"start","path":"/hooks/s5ymG9Er3qt…  |
| [H0966: POST /hooks/s5ymG9Er3qtb66vhYgZT2v6jdwxZeEwNpAtoXi09iU0   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0967: GET /runs?loopId=01M5233CEDHHKYVZGG7KXGEVFA&amp;limit=500  | 200  | {"items":{"id":"01M5233D84D033CP0QP2XCZ0Q0","ownerId":"local","loopId":"01M5233CEDHHKYVZGG7KXGEVFA","versionId":"01M5233CED105JS9QW9FB5XETR","invocationId":"01M5233D845PD1KEQBEMCMC0A4","status":"succeeded","it…  |
| [H0968: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M5233E1SVNGDPXP0PBKBQZH1","ownerId":"local","type":"webhook","payload":{"key":"permanent-business-key"},"dedupeKey":"permanent-business-key","source":"webhook:01M5233E1FRDCFXS7AXQ5NZNNZ","rec… |

## W-key-concurrent

concurrent keyed repeats

**PASS** — expected: five 202 acknowledgements; one run, four deduplicated receipts

Observed assertion result: {"acks":[202,202,202,202,202],"receipts":["deduplicated","deduplicated","deduplicated","deduplicated","admitted"]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0969: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":{"id":"01M5233DGNG52M2VY766S7GCPQ","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233DGNV5ZYJTB24G4PQPSV","status":"succeeded","it…  |
| [H0970: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0971: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0972: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0973: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0974: POST /hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H0975: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500  | 200  | {"items":{"id":"01M5233ECQZFCYQ79BCGBQN4BX","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233ECQP1VDQNVWKZXHA11P","status":"succeeded","it…  |
| [H0976: GET /runs?loopId=01M5233CFJ1YSD39ZEBR6YAXQP&amp;limit=500 | 200  | {"items":{"id":"01M5233ECQZFCYQ79BCGBQN4BX","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","invocationId":"01M5233ECQP1VDQNVWKZXHA11P","status":"succeeded","it…  |
| [H0977: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M5233ED81XZ0FYQK1SHXEB8H","ownerId":"local","type":"webhook","payload":{"key":"concurrent-key"},"dedupeKey":"concurrent-key","source":"webhook:01M5233CFZJN3079P5XHBTZKCS","receivedAt":"2026-1… |

## W-safe-config

private Events and endpoint summaries expose safe pinned config

**PASS** — expected: authentication recipe/name only, body/eventType/dedupeKey/configurationAvailable; admitted and deduplicated states with safe counters/run links

Observed assertion result: {"endpoint":{"id":"01M5233CFZJN3079P5XHBTZKCS","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","triggerNodeId":"start","path":"/hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs","authentication":{"type":"hmac-sha256","message":"body","header":"x-hub-signature-256","secretRef":"f4qa-1792145466966-hmac"},"configurationAvailable":true,"body":{"type":"json"},"eventType":{"source":"constant","value":"webhook"},"dedupeKey":"key","enabled":true,"createdAt":"2026-10-16T10:11:09.951Z"},"states":["deduplicated","admitted"],"example":{"id":"01M5233ED81XZ0FYQK1SHXEB8H","ownerId":"local","type":"webhook","payload":{"key":"concurrent-key"},"dedupeKey":"concurrent-key","source":"webhook:01M5233CFZJN3079P5XHBTZKCS","receivedAt":"2026-10-16T10:11:11.907Z","runIds":[],"webhook":{"id":"01M5233CFZJN3079P5XHBTZKCS","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","triggerNodeId":"start","path":"/hooks/fW-bNLRji70CvbwQ2e-iWU-hSk7bAzZjdACPCL6asFs","authentication":{"type":"hmac-sha256","message":"body","header":"x-hub-signature-256","secretRef":"f4qa-1792145466966-hmac"},"configurationAvailable":true,"body":{"type":"json"},"eventType":{"source":"constant","value":"webhook"},"dedupeKey":"key","enabled":true,"createdAt":"2026-10-16T10:11:09.951Z"},"delivery":{"state":"deduplicated","attempts":0}}}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0978: GET /loops/01M5233CFJ1YSD39ZEBR6YAXQP/triggers | 200  | {"schedules":[],"webhooks":{"id":"01M5233CFZJN3079P5XHBTZKCS","ownerId":"local","loopId":"01M5233CFJ1YSD39ZEBR6YAXQP","versionId":"01M5233CFJJ781J7WEZTPQHVVR","triggerNodeId":"start","path":"/hooks/fW-bNLRji70…  |
| [H0979: GET /events?limit=200                         | 200  | {"items":[{"id":"01M5233ED81XZ0FYQK1SHXEB8H","ownerId":"local","type":"webhook","payload":{"key":"concurrent-key"},"dedupeKey":"concurrent-key","source":"webhook:01M5233CFZJN3079P5XHBTZKCS","receivedAt":"2026-1… |

## W-disabled

republishing without webhook disables old endpoint

**PASS** — expected: old endpoint listed disabled; POST returns 404 HOOK_NOT_FOUND

Observed assertion result: {"listing":{"schedules":[],"webhooks":[{"id":"01M5233ETHJT2EW5STTQCJWGV4","ownerId":"local","loopId":"01M5233ET6S2V04BSZVTZGARMG","versionId":"01M5233ET65M38ETTENDPDSW4A","triggerNodeId":"start","path":"/hooks/TxE9K6emtuh6IQ32GslcwoYBo-DNRONWuecwuWLiWy0","authentication":{"type":"none"},"configurationAvailable":true,"body":{"type":"json"},"eventType":{"source":"constant","value":"webhook"},"enabled":false,"createdAt":"2026-10-16T10:11:12.337Z"}],"polls":[]},"response":{"type":"https://graphgoblin.dev/problems/hook-not-found","title":"hook not found","status":404,"code":"HOOK_NOT_FOUND","detail":"unknown webhook"}}

| Request                                                         | HTTP | Response excerpt                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0980: POST /loops                                              | 201  | {"loop":{"id":"01M5233ET6S2V04BSZVTZGARMG"},"draft":{"id":"01M5233ET65M38ETTENDPDSW4A","schemaVersion":4},"issues":[]}                                                                                              |
| H0981: POST /loops/01M5233ET6S2V04BSZVTZGARMG/publish           | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0982: GET /loops/01M5233ET6S2V04BSZVTZGARMG/triggers           | 200  | {"schedules":[],"webhooks":{"id":"01M5233ETHJT2EW5STTQCJWGV4","ownerId":"local","loopId":"01M5233ET6S2V04BSZVTZGARMG","versionId":"01M5233ET65M38ETTENDPDSW4A","triggerNodeId":"start","path":"/hooks/TxE9K6emtuh…  |
| [H0983: GET /loops/01M5233ET6S2V04BSZVTZGARMG                   | 200  | {"loop":{"id":"01M5233ET6S2V04BSZVTZGARMG","currentVersionId":"01M5233ET65M38ETTENDPDSW4A"},"draft":{}}                                                                                                             |
| H0984: PUT /loops/01M5233ET6S2V04BSZVTZGARMG/draft              | 200  | {"draft":{"id":"01M5233ETXMGKGNJQ3NMYEHMER","loopId":"01M5233ET6S2V04BSZVTZGARMG","version":2,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145466966 disable","settings":{"workingDirectory":… |
| H0985: POST /loops/01M5233ET6S2V04BSZVTZGARMG/publish           | 200  | {"version":2,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H0986: GET /loops/01M5233ET6S2V04BSZVTZGARMG/triggers           | 200  | {"schedules":[],"webhooks":{"id":"01M5233ETHJT2EW5STTQCJWGV4","ownerId":"local","loopId":"01M5233ET6S2V04BSZVTZGARMG","versionId":"01M5233ET65M38ETTENDPDSW4A","triggerNodeId":"start","path":"/hooks/TxE9K6emtuh…  |
| [H0987: POST /hooks/TxE9K6emtuh6IQ32GslcwoYBo-DNRONWuecwuWLiWy0 | 404  | {"code":"HOOK_NOT_FOUND","detail":"unknown webhook"}                                                                                                                                                                |

## W-unknown

unknown hook token

**PASS** — expected: 404 HOOK_NOT_FOUND

Observed assertion result: {"type":"https://graphgoblin.dev/problems/hook-not-found","title":"hook not found","status":404,"code":"HOOK_NOT_FOUND","detail":"unknown webhook"}

| Request                                              | HTTP | Response excerpt                                     |
| ---------------------------------------------------- | ---- | ---------------------------------------------------- |
| H0988: POST /hooks/f4qa-1792145466966-does-not-exist | 404  | {"code":"HOOK_NOT_FOUND","detail":"unknown webhook"} |

## EV-fanout

POST /events fans out to both matching triggers

**PASS** — expected: 202 duplicate=false with two run IDs; correct Event payload in both threads

Observed assertion result: {"id":"01M5237T7EMG0KTESCDDJ8NJ0V","ownerId":"local","type":"f4qa-1792145615028-event","payload":{"hello":"event","n":3},"source":"api","receivedAt":"2026-10-16T10:13:35.086Z","runIds":["01M5237T8DEG4CSAGEN0N21H9H","01M5237T8HV4PWGF41RJ17FHA3"],"duplicate":false}

| Request                                            | HTTP | Response excerpt                                                                                                                                                                                                    |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1125: POST /events                                | 202  | {"duplicate":false,"runIds":["01M5237T8DEG4CSAGEN0N21H9H","01M5237T8HV4PWGF41RJ17FHA3"],"id":"01M5237T7EMG0KTESCDDJ8NJ0V"}                                                                                          |
| H1126: GET /runs/01M5237T8DEG4CSAGEN0N21H9H        | 200  | {"id":"01M5237T8DEG4CSAGEN0N21H9H","ownerId":"local","loopId":"01M5237T6YVEH49QXTWENFJWF1","versionId":"01M5237T6YSTN7EGEPYJW2R4DR","invocationId":"01M5237T8D1E2YBFXKMQFBW74Y","status":"running","iteration":1,"… |
| H1127: GET /runs/01M5237T8DEG4CSAGEN0N21H9H        | 200  | {"status":"succeeded","outcome":"success","result":{"hello":"event","n":3}}                                                                                                                                         |
| H1128: GET /runs/01M5237T8DEG4CSAGEN0N21H9H/thread | 200  | {"schemaVersion":1,"run":{"id":"01M5237T8DEG4CSAGEN0N21H9H","loopId":"01M5237T6YVEH49QXTWENFJWF1","versionId":"01M5237T6YSTN7EGEPYJW2R4DR","iteration":1},"invocation":{"id":"01M5237T8D1E2YBFXKMQFBW74Y","source"… |
| H1129: GET /runs/01M5237T8HV4PWGF41RJ17FHA3        | 200  | {"status":"succeeded","outcome":"success","result":{"hello":"event","n":3}}                                                                                                                                         |
| H1130: GET /runs/01M5237T8HV4PWGF41RJ17FHA3/thread | 200  | {"schemaVersion":1,"run":{"id":"01M5237T8HV4PWGF41RJ17FHA3","loopId":"01M5237T6AZQRSFKE0NMQHEZTN","versionId":"01M5237T6AMGRTB9H6DY1A9VKX","iteration":1},"invocation":{"id":"01M5237T8HQDAT8B7EASQW8QC9","source"… |

## EV-key

global Event key repeats deduplicate

**PASS** — expected: 202 duplicate true on repeat with original ID/run IDs and no new fanout

Observed assertion result: {"first":{"id":"01M5237TD58K14FGY5S48AKH25","ownerId":"local","type":"f4qa-1792145615028-event","payload":{"key":"global"},"dedupeKey":"event-global-key","source":"api","receivedAt":"2026-10-16T10:13:35.269Z","runIds":["01M5237TE18TA1ES7AS2CH9W86","01M5237TE5DAG6MWJ6ES8BHS2M"],"duplicate":false},"repeat":{"id":"01M5237TD58K14FGY5S48AKH25","ownerId":"local","type":"f4qa-1792145615028-event","payload":{"key":"global"},"dedupeKey":"event-global-key","source":"api","receivedAt":"2026-10-16T10:13:35.269Z","runIds":["01M5237TE18TA1ES7AS2CH9W86","01M5237TE5DAG6MWJ6ES8BHS2M"],"duplicate":true}}

| Request             | HTTP | Response excerpt                                                                                                           |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| H1131: POST /events | 202  | {"duplicate":false,"runIds":["01M5237TE18TA1ES7AS2CH9W86","01M5237TE5DAG6MWJ6ES8BHS2M"],"id":"01M5237TD58K14FGY5S48AKH25"} |
| H1132: POST /events | 202  | {"duplicate":true,"runIds":["01M5237TE18TA1ES7AS2CH9W86","01M5237TE5DAG6MWJ6ES8BHS2M"],"id":"01M5237TD58K14FGY5S48AKH25"}  |

## EV-key-empty

empty Event envelope key retains old unkeyed behavior

**PASS** — expected: two 202 duplicate=false; distinct Event IDs and two runs per delivery

Observed assertion result: {"statuses":[202,202],"ids":["01M5237TEVJH006Y1M181VWGXF","01M5237THRPBAKT7QG2V5E9H78"],"duplicates":[false,false]}

| Request             | HTTP | Response excerpt                                                                                                           |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| H1133: POST /events | 202  | {"duplicate":false,"runIds":["01M5237TH17SD8STE4KX8WGJAT","01M5237TH8YS6G3MXJ9E2XDQKA"],"id":"01M5237TEVJH006Y1M181VWGXF"} |
| H1134: POST /events | 202  | {"duplicate":false,"runIds":["01M5237TNCESVBC9FBFTYXDRXT","01M5237TNR5WN4C62A3QD90WM6"],"id":"01M5237THRPBAKT7QG2V5E9H78"} |

## EV-key-invalid-513

Event key 513 uses existing validation

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/dedupeKey","message":"Too big: expected string to have <=512 characters"}]}

| Request             | HTTP | Response excerpt                                                                                                                                                               |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1135: POST /events | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/dedupeKey","message":"Too big: expected string to have &lt;=512 characters"}],"detail":"the request did not match the schema"} |

## EV-key-invalid-null

Event key null uses existing validation

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/dedupeKey","message":"Invalid input: expected string, received null"}]}

| Request             | HTTP | Response excerpt                                                                                                                                                        |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1136: POST /events | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/dedupeKey","message":"Invalid input: expected string, received null"}],"detail":"the request did not match the schema"} |

## EV-unmatched

unmatched Event type

**PASS** — expected: 202 stored; runIds empty

Observed assertion result: {"id":"01M5237TQ5760MX5BC6BFH2Q4M","ownerId":"local","type":"f4qa-1792145615028-event-unmatched","payload":null,"source":"api","receivedAt":"2026-10-16T10:13:35.589Z","runIds":[],"duplicate":false}

| Request             | HTTP | Response excerpt                                                  |
| ------------------- | ---- | ----------------------------------------------------------------- |
| H1137: POST /events | 202  | {"duplicate":false,"runIds":[],"id":"01M5237TQ5760MX5BC6BFH2Q4M"} |

## EV-node-key

Event trigger expression keys remain per-node deduplicated

**PASS** — expected: two stored distinct events; one matching run across both posts

Observed assertion result: {"first":{"id":"01M5237TS4QYK2YJFEZM0XCTK4","ownerId":"local","type":"f4qa-1792145615028-event-node-key","payload":{"id":"same"},"source":"api","receivedAt":"2026-10-16T10:13:35.652Z","runIds":["01M5237TSX5FP3RK5DPX9CKY27"],"duplicate":false},"repeat":{"id":"01M5237TT6X814424PT7KAR7QK","ownerId":"local","type":"f4qa-1792145615028-event-node-key","payload":{"id":"same"},"source":"api","receivedAt":"2026-10-16T10:13:35.686Z","runIds":[],"duplicate":false}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1138: POST /loops                                               | 201  | {"loop":{"id":"01M5237TRP0Q8E0JES9VR6J78M"},"draft":{"id":"01M5237TRPQATPDNHFQWDW23SF","schemaVersion":4},"issues":[]}                                                                                              |
| H1139: POST /loops/01M5237TRP0Q8E0JES9VR6J78M/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1140: POST /events                                              | 202  | {"duplicate":false,"runIds":["01M5237TSX5FP3RK5DPX9CKY27"],"id":"01M5237TS4QYK2YJFEZM0XCTK4"}                                                                                                                       |
| H1141: POST /events                                              | 202  | {"duplicate":false,"runIds":[],"id":"01M5237TT6X814424PT7KAR7QK"}                                                                                                                                                   |
| H1142: GET /runs?loopId=01M5237TRP0Q8E0JES9VR6J78M&amp;limit=500 | 200  | {"items":[{"id":"01M5237TSX5FP3RK5DPX9CKY27","ownerId":"local","loopId":"01M5237TRP0Q8E0JES9VR6J78M","versionId":"01M5237TRPQATPDNHFQWDW23SF","invocationId":"01M5237TSXWHDA4HQZNHBGB322","status":"succeeded","it… |

## P-none

poll none probe

**PASS** — expected: armed poll; one successful run; poll envelope/probe retained

Observed assertion result: {"listing":[{"ownerId":"local","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:13:46.068Z"}],"runs":[{"id":"01M523802DSZE4N06373VSME61","ownerId":"local","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","invocationId":"01M523802D0YNSM9Q86MJJ9CYZ","status":"succeeded","iteration":1,"outcome":"success","createdAt":"2026-10-16T10:13:41.069Z","startedAt":"2026-10-16T10:13:41.083Z","finishedAt":"2026-10-16T10:13:41.120Z","lastEventSeq":9}]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1149: GET /loops/01M5237TVQYZFCNPBDK5DSZB16/triggers             | 200  | {"schedules":[],"webhooks":[],"polls":{"ownerId":"local","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:1…  |
| [H1150: GET /runs?loopId=01M5237TVQYZFCNPBDK5DSZB16&amp;limit=500 | 200  | {"items":{"id":"01M523802DSZE4N06373VSME61","ownerId":"local","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","invocationId":"01M523802D0YNSM9Q86MJJ9CYZ","status":"succeeded","it…  |
| [H1151: GET /runs/01M523802DSZE4N06373VSME61                      | 200  | {"status":"succeeded","outcome":"success"}                                                                                                                                                                          |
| H1152: GET /runs/01M523802DSZE4N06373VSME61/thread                | 200  | {"schemaVersion":1,"run":{"id":"01M523802DSZE4N06373VSME61","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","iteration":1},"invocation":{"id":"01M523802D0YNSM9Q86MJJ9CYZ","source"… |

## P-script

poll script probe

**PASS** — expected: armed poll; one successful run; poll envelope/probe retained

Observed assertion result: {"listing":[{"ownerId":"local","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:13:46.068Z"}],"runs":[{"id":"01M523804MCSF3CJSEQE8MDRAW","ownerId":"local","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","invocationId":"01M523804MZF05924GQSTGVE19","status":"succeeded","iteration":1,"outcome":"success","result":{"exitCode":0,"stdout":"{\"ready\":true}","stderr":"","json":{"ready":true},"timedOut":false},"createdAt":"2026-10-16T10:13:41.140Z","startedAt":"2026-10-16T10:13:41.145Z","finishedAt":"2026-10-16T10:13:41.163Z","lastEventSeq":9}]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1153: GET /loops/01M5237TW6EKW51WVB8K28EQ1W/triggers             | 200  | {"schedules":[],"webhooks":[],"polls":{"ownerId":"local","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:1…  |
| [H1154: GET /runs?loopId=01M5237TW6EKW51WVB8K28EQ1W&amp;limit=500 | 200  | {"items":{"id":"01M523804MCSF3CJSEQE8MDRAW","ownerId":"local","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","invocationId":"01M523804MZF05924GQSTGVE19","status":"succeeded","it…  |
| [H1155: GET /runs/01M523804MCSF3CJSEQE8MDRAW                      | 200  | {"status":"succeeded","outcome":"success","result":{"exitCode":0,"stdout":"{\"ready\":true}","stderr":"","json":{"ready":true},"timedOut":false}}                                                                   |
| H1156: GET /runs/01M523804MCSF3CJSEQE8MDRAW/thread                | 200  | {"schemaVersion":1,"run":{"id":"01M523804MCSF3CJSEQE8MDRAW","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","iteration":1},"invocation":{"id":"01M523804MZF05924GQSTGVE19","source"… |

## P-false

poll false probe

**PASS** — expected: armed poll; no run when fireWhen=false

Observed assertion result: {"listing":[{"ownerId":"local","loopId":"01M5237TWQMQ6MW4PC0T792SJZ","versionId":"01M5237TWQD4BQ9JNRD75QHW93","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:13:46.068Z"}],"runs":[]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1157: GET /loops/01M5237TWQMQ6MW4PC0T792SJZ/triggers             | 200  | {"schedules":[],"webhooks":[],"polls":{"ownerId":"local","loopId":"01M5237TWQMQ6MW4PC0T792SJZ","versionId":"01M5237TWQD4BQ9JNRD75QHW93","triggerNodeId":"start","intervalSeconds":5,"nextPollAt":"2026-10-16T10:1… |
| [H1158: GET /runs?loopId=01M5237TWQMQ6MW4PC0T792SJZ&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## P-key

poll key remains consumed on later sweeps

**PASS** — expected: still one run per true poll after a second tick; false poll still zero

Observed assertion result: [{"probe":"none","count":1},{"probe":"script","count":1},{"probe":"false","count":0}]

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1159: GET /runs?loopId=01M5237TVQYZFCNPBDK5DSZB16&amp;limit=500  | 200  | {"items":{"id":"01M523802DSZE4N06373VSME61","ownerId":"local","loopId":"01M5237TVQYZFCNPBDK5DSZB16","versionId":"01M5237TVQKGEGSN4YG9T398FJ","invocationId":"01M523802D0YNSM9Q86MJJ9CYZ","status":"succeeded","it… |
| [H1160: GET /runs?loopId=01M5237TW6EKW51WVB8K28EQ1W&amp;limit=500 | 200  | {"items":{"id":"01M523804MCSF3CJSEQE8MDRAW","ownerId":"local","loopId":"01M5237TW6EKW51WVB8K28EQ1W","versionId":"01M5237TW7WNW4D31DW90KVEFD","invocationId":"01M523804MZF05924GQSTGVE19","status":"succeeded","it… |
| [H1161: GET /runs?loopId=01M5237TWQMQ6MW4PC0T792SJZ&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## P-disabled

published disabled polls disarm

**PASS** — expected: trigger listing has zero armed polls

Observed assertion result: [[],[],[]]

| Request                                               | HTTP | Response excerpt                          |
| ----------------------------------------------------- | ---- | ----------------------------------------- |
| H1171: GET /loops/01M5237TVQYZFCNPBDK5DSZB16/triggers | 200  | {"schedules":[],"webhooks":[],"polls":[]} |
| H1172: GET /loops/01M5237TW6EKW51WVB8K28EQ1W/triggers | 200  | {"schedules":[],"webhooks":[],"polls":[]} |
| H1173: GET /loops/01M5237TWQMQ6MW4PC0T792SJZ/triggers | 200  | {"schedules":[],"webhooks":[],"polls":[]} |

## P-invalid

poll interval below five seconds

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/intervalSeconds","message":"Too small: expected number to be >=5"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                  |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1174: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/intervalSeconds","message":"Too small: expected number to be &gt;=5"}],"detail":"the request did not match the schema"} |

## C-preview

cron preview exact UTC slots

**PASS** — expected: 200 three strictly later five-minute slots; no schedule/run creation

Observed assertion result: {"next":["2026-10-16T00:05:00.000Z","2026-10-16T00:10:00.000Z","2026-10-16T00:15:00.000Z"]}

| Request                            | HTTP | Response excerpt                                                                            |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| H1175: POST /triggers/cron/preview | 200  | {"next":["2026-10-16T00:05:00.000Z","2026-10-16T00:10:00.000Z","2026-10-16T00:15:00.000Z"]} |

## C-invalid-expression

cron preview invalid expression

**PASS** — expected: 400 CRON_INVALID with field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/cron-invalid","title":"cron invalid","status":400,"code":"CRON_INVALID","detail":"CronPattern: invalid configuration format ('not cron'), exactly five, six, or seven space separated parts are required.","errors":[{"path":"/expression","message":"CronPattern: invalid configuration format ('not cron'), exactly five, six, or seven space separated parts are required."}]}

| Request                            | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1176: POST /triggers/cron/preview | 400  | {"code":"CRON_INVALID","errors":[{"path":"/expression","message":"CronPattern: invalid configuration format ('not cron'), exactly five, six, or seven space separated parts are required."}],"detail":"CronPattern… |

## C-invalid-timezone

cron preview invalid timezone

**PASS** — expected: 400 CRON_INVALID with field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/cron-invalid","title":"cron invalid","status":400,"code":"CRON_INVALID","detail":"Invalid time zone specified: Not/A_Zone","errors":[{"path":"/timezone","message":"Invalid time zone specified: Not/A_Zone"}]}

| Request                            | HTTP | Response excerpt                                                                                                                                               |
| ---------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1177: POST /triggers/cron/preview | 400  | {"code":"CRON_INVALID","errors":[{"path":"/timezone","message":"Invalid time zone specified: Not/A_Zone"}],"detail":"Invalid time zone specified: Not/A_Zone"} |

## C-invalid-count-zero

cron preview invalid count-zero

**PASS** — expected: 400 VALIDATION_FAILED with field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/count","message":"Too small: expected number to be >=1"}]}

| Request                            | HTTP | Response excerpt                                                                                                                                              |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1178: POST /triggers/cron/preview | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/count","message":"Too small: expected number to be &gt;=1"}],"detail":"the request did not match the schema"} |

## C-invalid-count-eleven

cron preview invalid count-eleven

**PASS** — expected: 400 VALIDATION_FAILED with field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/count","message":"Too big: expected number to be <=10"}]}

| Request                            | HTTP | Response excerpt                                                                                                                                             |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1179: POST /triggers/cron/preview | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/count","message":"Too big: expected number to be &lt;=10"}],"detail":"the request did not match the schema"} |

## C-invalid-from

cron preview invalid from

**PASS** — expected: 400 VALIDATION_FAILED with field path

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/from","message":"Invalid ISO datetime"}]}

| Request                            | HTTP | Response excerpt                                                                                                                          |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| H1180: POST /triggers/cron/preview | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/from","message":"Invalid ISO datetime"}],"detail":"the request did not match the schema"} |

## C-publish

cron publish arms a future schedule

**PASS** — expected: 200 publish; enabled schedule with nextFireAt and no immediate run

Observed assertion result: {"schedules":[{"id":"01M523863K5YBPJFJ2GWKDH89C","ownerId":"local","loopId":"01M5238635Q9HQP8FP5D4GZ19D","versionId":"01M523863549KNW8KXC1AQDG3G","triggerNodeId":"start","expression":"0 0 1 1 *","timezone":"UTC","missedFirePolicy":"skip","enabled":true,"nextFireAt":"2027-01-01T00:00:00.000Z","createdAt":"2026-10-16T10:13:47.250Z"}],"webhooks":[],"polls":[]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1181: POST /loops                                                | 201  | {"loop":{"id":"01M5238635Q9HQP8FP5D4GZ19D"},"draft":{"id":"01M523863549KNW8KXC1AQDG3G","schemaVersion":4},"issues":[]}                                                                                             |
| H1182: POST /loops/01M5238635Q9HQP8FP5D4GZ19D/publish             | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H1183: GET /loops/01M5238635Q9HQP8FP5D4GZ19D/triggers             | 200  | {"schedules":{"id":"01M523863K5YBPJFJ2GWKDH89C","ownerId":"local","loopId":"01M5238635Q9HQP8FP5D4GZ19D","versionId":"01M523863549KNW8KXC1AQDG3G","triggerNodeId":"start","expression":"0 0 1 1 *","timezone":"UTC… |
| [H1184: GET /runs?loopId=01M5238635Q9HQP8FP5D4GZ19D&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## C-invalid-publish

invalid cron cannot publish

**PASS** — expected: draft CRON_INVALID issue; publish 422 LOOP_INVALID

Observed assertion result: {"issues":[{"code":"CRON_INVALID","severity":"error","message":"cron trigger \"start\": CronPattern: invalid configuration format ('bad'), exactly five, six, or seven space separated parts are required.","nodeId":"start","path":"config.expression"}],"publish":{"type":"https://graphgoblin.dev/problems/loop-invalid","title":"loop invalid","status":422,"code":"LOOP_INVALID","detail":"the draft has structural errors","errors":[{"code":"CRON_INVALID","severity":"error","message":"cron trigger \"start\": CronPattern: invalid configuration format ('bad'), exactly five, six, or seven space separated parts are required.","nodeId":"start","path":"config.expression"}]}}

| Request                                                | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1185: POST /loops                                     | 201  | {"loop":{"id":"01M523863ZM4PX5QFKK5PHS7E7"},"draft":{"id":"01M523863Z6NP8HJDCFPBSWWTQ","schemaVersion":4},"issues":{"code":"CRON_INVALID","severity":"error","message":"cron trigger \"start\": CronPattern: inva…  |
| [H1186: POST /loops/01M523863ZM4PX5QFKK5PHS7E7/publish | 422  | {"code":"LOOP_INVALID","errors":[{"code":"CRON_INVALID","severity":"error","message":"cron trigger \"start\": CronPattern: invalid configuration format ('bad'), exactly five, six, or seven space separated parts… |

## I-auto

format-3 portable export converts automatically

**PASS** — expected: 201 format 4; rewrite notices; old fields removed; draft publishes and expression-only run succeeds

Observed assertion result: {"status":201,"issues":[],"notices":[{"code":"unused-controls","path":"/nodes/1/config","message":"Remove unused classifier criteria and recording controls from expression/LLM decisions."}],"definition":{"schemaVersion":4,"name":"f4qa-1792145615028 auto conversion","settings":{"workingDirectory":{"kind":"temp"},"defaults":{"byHarness":{}},"maxNodeVisits":7,"subloopDepthLimit":8},"variables":{},"nodes":[{"id":"start","label":"start","ui":{"x":0,"y":0},"kind":"trigger","config":{"type":"manual","exposeTo":["ui","api","mcp"]}},{"id":"pick","label":"pick","ui":{"x":0,"y":0},"kind":"decision","config":{"kind":"expression","jsonata":"\"yes\"","routes":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]}},{"id":"done","label":"done","ui":{"x":0,"y":0},"kind":"exit","config":{"outcome":"success","returns":"none","destinations":[{"kind":"caller"}]}}],"edges":[{"id":"e1","from":{"node":"start","port":"out"},"to":{"node":"pick","port":"in"}},{"id":"e2","from":{"node":"pick","port":"yes"},"to":{"node":"done","port":"in"}},{"id":"e3","from":{"node":"pick","port":"no"},"to":{"node":"done","port":"in"}}]},"runStatus":"succeeded"}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1187: POST /loops/import                             | 201  | {"notices":[{"code":"unused-controls","path":"/nodes/1/config","message":"Remove unused classifier criteria and recording controls from expression/LLM decisions."}],"issues":[],"schemaVersion":4}                 |
| H1188: POST /loops/01M523864FS1VYTEH7N61QV028/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1189: POST /loops/01M523864FS1VYTEH7N61QV028/runs    | 202  | {"run":{"id":"01M5238651BKVB420GJHCX0AH4","ownerId":"local","loopId":"01M523864FS1VYTEH7N61QV028","versionId":"01M523864FF1ZJ01PD39GZJKX7","invocationId":"01M5238651RY4JAE6DQ2F787YD","status":"queued","iteratio… |
| H1190: GET /runs/01M5238651BKVB420GJHCX0AH4           | 200  | {"id":"01M5238651BKVB420GJHCX0AH4","ownerId":"local","loopId":"01M523864FS1VYTEH7N61QV028","versionId":"01M523864FF1ZJ01PD39GZJKX7","invocationId":"01M5238651RY4JAE6DQ2F787YD","status":"running","iteration":1,"… |
| H1191: GET /runs/01M5238651BKVB420GJHCX0AH4           | 200  | {"status":"succeeded","outcome":"success"}                                                                                                                                                                          |

## I-auto-bare

bare format-3 minimal definition converts

**PASS** — expected: 201 current draft with notices array

Observed assertion result: {"loop":{"id":"01M5238690PFY7ACGH1B7VQKEY","ownerId":"local","name":"f4qa-1792145615028 bare old","draftVersionId":"01M52386909BH4TTY9C4AEVGNE","createdAt":"2026-10-16T10:13:47.424Z","updatedAt":"2026-10-16T10:13:47.424Z"},"draft":{"id":"01M52386909BH4TTY9C4AEVGNE","loopId":"01M5238690PFY7ACGH1B7VQKEY","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145615028 bare old","settings":{"workingDirectory":{"kind":"temp"},"defaults":{"byHarness":{}},"maxNodeVisits":10,"subloopDepthLimit":8},"variables":{},"nodes":[{"id":"start","label":"start","ui":{"x":0,"y":0},"kind":"trigger","config":{"type":"manual","exposeTo":["ui","api","mcp"]}},{"id":"done","label":"done","ui":{"x":0,"y":0},"kind":"exit","config":{"outcome":"success","returns":"none","destinations":[{"kind":"caller"}]}}],"edges":[{"id":"e1","from":{"node":"start","port":"out"},"to":{"node":"done","port":"in"}}]},"createdAt":"2026-10-16T10:13:47.424Z"},"issues":[],"notices":[]}

| Request                   | HTTP | Response excerpt                             |
| ------------------------- | ---- | -------------------------------------------- |
| H1192: POST /loops/import | 201  | {"notices":[],"issues":[],"schemaVersion":4} |

## I-pending-llm

format-3 LLM decision requires review

**PASS** — expected: 400 LOOP_FORMAT_UPGRADE_REQUIRED; pending review item IDs/hashes/reasons; no loop created

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-format-upgrade-required","title":"loop format upgrade required","status":400,"code":"LOOP_FORMAT_UPGRADE_REQUIRED","detail":"Review is required. Run graphgoblin-upgrade export --input old.json --out review.json. For v3 items, create resolutions.json with {\"v3\":{\"<id>\":{\"hash\":\"<reported hash>\",\"action\":\"approve\",\"reason\":\"Reviewed this exact proposal\"}}}, using each reported id/hash. Some items require action \"replace\" with a value, or allow \"remove\". Earlier-stage items use the v1/v2 namespaces in the guide. Retry export with --resolutions resolutions.json and a new output path. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.","errors":{"issues":[{"code":"UPGRADE_REVIEW_REQUIRED","path":"/nodes/1/config/evaluation/question","message":"Owner must review the complete instruction derived from the question and criteria; judgment equivalence is not assumed.","kind":"pending","id":"/nodes/1/config/evaluation/question:llm-instructions","hash":"03d5050bec150ef5fa7115a65996decb25bdbc39315e497f843aaab6192f3ddb"}],"reviewItems":[{"id":"/nodes/1/config:unused-controls","nodeId":"pick","path":"/nodes/1/config","kind":"unused-controls","oldValue":{"answer":{"type":"choice","options":[{"id":"yes","label":"Yes","criteria":"Ready"},{"id":"no","label":"No","criteria":"Not ready"}]},"recordAlternatives":true},"pro…

| Request                    | HTTP | Response excerpt                                                                                                                                                                                                    |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1193: GET /loops          | 200  | {"items":{"id":"01M5238690PFY7ACGH1B7VQKEY","ownerId":"local","name":"f4qa-1792145615028 bare old","draftVersionId":"01M52386909BH4TTY9C4AEVGNE","createdAt":"2026-10-16T10:13:47.424Z","updatedAt":"2026-10-16T1…  |
| [H1194: POST /loops/import | 400  | {"code":"LOOP_FORMAT_UPGRADE_REQUIRED","errors":{"issues":{"code":"UPGRADE_REVIEW_REQUIRED","path":"/nodes/1/config/evaluation/question","message":"Owner must review the complete instruction derived from the q…  |
| [H1195: GET /loops         | 200  | {"items":[{"id":"01M5238690PFY7ACGH1B7VQKEY","ownerId":"local","name":"f4qa-1792145615028 bare old","draftVersionId":"01M52386909BH4TTY9C4AEVGNE","createdAt":"2026-10-16T10:13:47.424Z","updatedAt":"2026-10-16T1… |

## I-pending-webhook

format-3 webhook decoding changes require review

**PASS** — expected: 400 LOOP_FORMAT_UPGRADE_REQUIRED with webhook-json-decoding review

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-format-upgrade-required","title":"loop format upgrade required","status":400,"code":"LOOP_FORMAT_UPGRADE_REQUIRED","detail":"Review is required. Run graphgoblin-upgrade export --input old.json --out review.json. For v3 items, create resolutions.json with {\"v3\":{\"<id>\":{\"hash\":\"<reported hash>\",\"action\":\"approve\",\"reason\":\"Reviewed this exact proposal\"}}}, using each reported id/hash. Some items require action \"replace\" with a value, or allow \"remove\". Earlier-stage items use the v1/v2 namespaces in the guide. Retry export with --resolutions resolutions.json and a new output path. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.","errors":{"issues":[{"code":"UPGRADE_REVIEW_REQUIRED","path":"/nodes/0/config","message":"Review strict UTF-8 and nonempty JSON intake: empty/whitespace JSON now rejects (literal null remains valid); malformed UTF-8 no longer becomes replacement characters. Timestamp intake previously accepted empty bodies differently. Payload and key values are preserved; filters have a separate graph review.","kind":"pending","id":"/nodes/0/config:webhook-json-decoding","hash":"9b5e43ba45c4480c60a70095c4fd237a23de231e19e6518394a2ccf3f4d17dea"}],"reviewItems":{"id":"/nodes/0/config:webhook-json-decoding","nodeId":"start","path":"/nodes/0/config","kind":"webhook-json-decoding","oldValue":…

| Request                    | HTTP | Response excerpt                                                                                                                                                                                                    |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H1196: POST /loops/import | 400  | {"code":"LOOP_FORMAT_UPGRADE_REQUIRED","errors":{"issues":[{"code":"UPGRADE_REVIEW_REQUIRED","path":"/nodes/0/config","message":"Review strict UTF-8 and nonempty JSON intake: empty/whitespace JSON now rejects (… |

## I-invalid-malformed-v3

invalid old source malformed-v3

**PASS** — expected: 400 LOOP_IMPORT_SOURCE_INVALID; invalid issue classification; no loop

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-import-source-invalid","title":"loop import source invalid","status":400,"code":"LOOP_IMPORT_SOURCE_INVALID","detail":"The source, export envelope or conversion has invalid issues. Correct the listed invalid issues; graphgoblin-upgrade export cannot convert invalid source. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.","errors":{"issues":[{"code":"UPGRADE_V3_INVALID","path":"/","message":"current definition violates format 3","kind":"invalid"}],"reviewItems":[]}}

| Request                   | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1197: POST /loops/import | 400  | {"code":"LOOP_IMPORT_SOURCE_INVALID","errors":{"issues":[{"code":"UPGRADE_V3_INVALID","path":"/","message":"current definition violates format 3","kind":"invalid"}],"reviewItems":[]},"detail":"The source, expor… |

## I-invalid-bad-envelope

invalid old source bad-envelope

**PASS** — expected: 400 LOOP_IMPORT_SOURCE_INVALID; invalid issue classification; no loop

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-import-source-invalid","title":"loop import source invalid","status":400,"code":"LOOP_IMPORT_SOURCE_INVALID","detail":"The source, export envelope or conversion has invalid issues. Correct the listed invalid issues; graphgoblin-upgrade export cannot convert invalid source. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.","errors":{"issues":[{"code":"UPGRADE_EXPORT_INVALID","path":"/","message":"expected a matching exact loop export envelope and timestamp","kind":"invalid"}],"reviewItems":[]}}

| Request                   | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1198: POST /loops/import | 400  | {"code":"LOOP_IMPORT_SOURCE_INVALID","errors":{"issues":[{"code":"UPGRADE_EXPORT_INVALID","path":"/","message":"expected a matching exact loop export envelope and timestamp","kind":"invalid"}],"reviewItems":[]}… |

## I-invalid-unknown-field

invalid old source unknown-field

**PASS** — expected: 400 LOOP_IMPORT_SOURCE_INVALID; invalid issue classification; no loop

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-import-source-invalid","title":"loop import source invalid","status":400,"code":"LOOP_IMPORT_SOURCE_INVALID","detail":"The source, export envelope or conversion has invalid issues. Correct the listed invalid issues; graphgoblin-upgrade export cannot convert invalid source. See docs/guide/08-offline-upgrade.md#convert-a-portable-export.","errors":{"issues":[{"code":"UPGRADE_V3_INVALID","path":"/","message":"current definition violates format 3","kind":"invalid"}],"reviewItems":[]}}

| Request                   | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1199: POST /loops/import | 400  | {"code":"LOOP_IMPORT_SOURCE_INVALID","errors":{"issues":[{"code":"UPGRADE_V3_INVALID","path":"/","message":"current definition violates format 3","kind":"invalid"}],"reviewItems":[]},"detail":"The source, expor… |

## T-catalog

catalogue lists all starting points

**PASS** — expected: 200 starter/implementation/review/qa; manifest-only entries

Observed assertion result: {"items":[{"manifest":{"id":"starter","version":"2.0.0","title":"Starter assistant","description":"Summarize supplied input and suggest a next step with an ordinary inference node. No automatic GitHub effects.","tags":["starter","assistant"],"draftFile":"draft.json"}},{"manifest":{"id":"implementation","version":"2.0.0","title":"Implementation workflow","description":"Plan a supplied task, implement a focused change and assess verification with a bounded repair loop of ordinary nodes. No commits, pushes, pull requests or labels.","tags":["implementation","planning","verification"],"draftFile":"draft.json"}},{"manifest":{"id":"review","version":"2.0.0","title":"Review workflow","description":"Review a supplied change with separate fresh reviewer and fixer turns, then review again within a bounded cycle of ordinary nodes. No pushes, GitHub approvals, labels or merges.","tags":["review","fixes"],"draftFile":"draft.json"}},{"manifest":{"id":"qa","version":"2.0.0","title":"QA assessment","description":"Define criteria, assess supplied evidence and challenge the assessment with separate fresh turns in ordinary nodes. No GitHub effects, authenticated proof or enforced evidence isolation.","tags":["qa","evidence","adversarial"],"draftFile":"draft.json"}}]}

| Request               | HTTP | Response excerpt                                                                                                                                                                                                    |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1200: GET /templates | 200  | {"items":[{"manifest":{"id":"starter","version":"2.0.0","title":"Starter assistant","description":"Summarize supplied input and suggest a next step with an ordinary inference node. No automatic GitHub effects."… |

## T-draft-starter

Use starter creates ordinary draft

**PASS** — expected: 201 editable format-4 loop; no published version, binding or runs; GET loop round trip

Observed assertion result: {"loop":{"id":"01M52386BBTTVEKZP18HZ36QPW","ownerId":"local","name":"f4qa-1792145615028 copy starter","description":"Summarize supplied input and suggest a next step. Edit the workflow instructions, model defaults, or nodes at any time.","draftVersionId":"01M52386BBKXCR3Q4A3YGAZY73","createdAt":"2026-10-16T10:13:47.499Z","updatedAt":"2026-10-16T10:13:47.499Z"},"draftId":"01M52386BBKXCR3Q4A3YGAZY73","issues":[]}

| Request                                                          | HTTP | Response excerpt                                                                                                       |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| H1201: POST /templates/starter/draft                             | 201  | {"loop":{"id":"01M52386BBTTVEKZP18HZ36QPW"},"draft":{"id":"01M52386BBKXCR3Q4A3YGAZY73","schemaVersion":4},"issues":[]} |
| H1202: GET /loops/01M52386BBTTVEKZP18HZ36QPW                     | 200  | {"loop":{"id":"01M52386BBTTVEKZP18HZ36QPW"},"draft":{"id":"01M52386BBKXCR3Q4A3YGAZY73","schemaVersion":4}}             |
| H1203: GET /runs?loopId=01M52386BBTTVEKZP18HZ36QPW&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                         |

## T-draft-implementation

Use implementation creates ordinary draft

**PASS** — expected: 201 editable format-4 loop; no published version, binding or runs; GET loop round trip

Observed assertion result: {"loop":{"id":"01M52386CBH3T9Q8M30VDYKE1B","ownerId":"local","name":"f4qa-1792145615028 copy implementation","description":"Plan a task, develop a proposed or local change, and verify its evidence with a finite repair loop. Configure a working directory in the editor when needed.","draftVersionId":"01M52386CBA2YJGE6J6VVTBV0X","createdAt":"2026-10-16T10:13:47.531Z","updatedAt":"2026-10-16T10:13:47.531Z"},"draftId":"01M52386CBA2YJGE6J6VVTBV0X","issues":[]}

| Request                                                          | HTTP | Response excerpt                                                                                                       |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| H1204: POST /templates/implementation/draft                      | 201  | {"loop":{"id":"01M52386CBH3T9Q8M30VDYKE1B"},"draft":{"id":"01M52386CBA2YJGE6J6VVTBV0X","schemaVersion":4},"issues":[]} |
| H1205: GET /loops/01M52386CBH3T9Q8M30VDYKE1B                     | 200  | {"loop":{"id":"01M52386CBH3T9Q8M30VDYKE1B"},"draft":{"id":"01M52386CBA2YJGE6J6VVTBV0X","schemaVersion":4}}             |
| H1206: GET /runs?loopId=01M52386CBH3T9Q8M30VDYKE1B&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                         |

## T-draft-review

Use review creates ordinary draft

**PASS** — expected: 201 editable format-4 loop; no published version, binding or runs; GET loop round trip

Observed assertion result: {"loop":{"id":"01M52386DA1P325B55CTH44AXP","ownerId":"local","name":"f4qa-1792145615028 copy review","description":"Review supplied code or change context, propose or apply focused fixes, and review again with a finite iteration limit. This workflow does not grant merge authority.","draftVersionId":"01M52386DA6TRX49QGWDQ5X74D","createdAt":"2026-10-16T10:13:47.562Z","updatedAt":"2026-10-16T10:13:47.562Z"},"draftId":"01M52386DA6TRX49QGWDQ5X74D","issues":[]}

| Request                                                          | HTTP | Response excerpt                                                                                                       |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| H1207: POST /templates/review/draft                              | 201  | {"loop":{"id":"01M52386DA1P325B55CTH44AXP"},"draft":{"id":"01M52386DA6TRX49QGWDQ5X74D","schemaVersion":4},"issues":[]} |
| H1208: GET /loops/01M52386DA1P325B55CTH44AXP                     | 200  | {"loop":{"id":"01M52386DA1P325B55CTH44AXP"},"draft":{"id":"01M52386DA6TRX49QGWDQ5X74D","schemaVersion":4}}             |
| H1209: GET /runs?loopId=01M52386DA1P325B55CTH44AXP&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                         |

## T-draft-qa

Use qa creates ordinary draft

**PASS** — expected: 201 editable format-4 loop; no published version, binding or runs; GET loop round trip

Observed assertion result: {"loop":{"id":"01M52386E9NECVM1RJ7HQ8K3CH","ownerId":"local","name":"f4qa-1792145615028 copy qa","description":"Define acceptance criteria, assess supplied test evidence, and challenge the assessment with one bounded rerun. This worksheet supplies neither authenticated post-merge proof nor enforced isolation.","draftVersionId":"01M52386E9CVZ83Y5SE6M2T6SH","createdAt":"2026-10-16T10:13:47.593Z","updatedAt":"2026-10-16T10:13:47.593Z"},"draftId":"01M52386E9CVZ83Y5SE6M2T6SH","issues":[]}

| Request                                                          | HTTP | Response excerpt                                                                                                       |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| H1210: POST /templates/qa/draft                                  | 201  | {"loop":{"id":"01M52386E9NECVM1RJ7HQ8K3CH"},"draft":{"id":"01M52386E9CVZ83Y5SE6M2T6SH","schemaVersion":4},"issues":[]} |
| H1211: GET /loops/01M52386E9NECVM1RJ7HQ8K3CH                     | 200  | {"loop":{"id":"01M52386E9NECVM1RJ7HQ8K3CH"},"draft":{"id":"01M52386E9CVZ83Y5SE6M2T6SH","schemaVersion":4}}             |
| H1212: GET /runs?loopId=01M52386E9NECVM1RJ7HQ8K3CH&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                         |

## T-independent

repeat copies are independently editable

**PASS** — expected: distinct loop/version IDs; first copy edit preserves second and catalogue default

Observed assertion result: {"loopIds":["01M52386BBTTVEKZP18HZ36QPW","01M52386F5MA15T7QGM4RV3TFN","01M52386G9QMSB7H9S6EF2RP8Y"],"editedLabel":"QA edited independent copy","otherLabel":"Run input and context"}

| Request                                            | HTTP | Response excerpt                                                                                                                                                                                                    |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1213: POST /templates/starter/draft               | 201  | {"loop":{"id":"01M52386F5MA15T7QGM4RV3TFN"},"draft":{"id":"01M52386F5RCCJVK4EKGB4496M","schemaVersion":4},"issues":[]}                                                                                              |
| H1214: GET /loops/01M52386BBTTVEKZP18HZ36QPW       | 200  | {"loop":{"id":"01M52386BBTTVEKZP18HZ36QPW"},"draft":{"id":"01M52386BBKXCR3Q4A3YGAZY73","schemaVersion":4}}                                                                                                          |
| H1215: PUT /loops/01M52386BBTTVEKZP18HZ36QPW/draft | 200  | {"draft":{"id":"01M52386BBKXCR3Q4A3YGAZY73","loopId":"01M52386BBTTVEKZP18HZ36QPW","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145615028 copy starter","description":"Summarize s… |
| H1216: GET /loops/01M52386F5MA15T7QGM4RV3TFN       | 200  | {"loop":{"id":"01M52386F5MA15T7QGM4RV3TFN"},"draft":{"id":"01M52386F5RCCJVK4EKGB4496M","schemaVersion":4}}                                                                                                          |
| H1217: POST /templates/starter/draft               | 201  | {"loop":{"id":"01M52386G9QMSB7H9S6EF2RP8Y"},"draft":{"id":"01M52386G9Z0006GMFM4GAC311","schemaVersion":4},"issues":[]}                                                                                              |

## T-direct-run

cannot execute template directly /templates/starter/runs

**PASS** — expected: 404; no execution endpoint

Observed assertion result: {"type":"https://graphgoblin.dev/problems/not-found","title":"not found","status":404,"code":"NOT_FOUND","detail":"POST /templates/starter/runs does not exist"}

| Request                             | HTTP | Response excerpt                                                            |
| ----------------------------------- | ---- | --------------------------------------------------------------------------- |
| H1218: POST /templates/starter/runs | 404  | {"code":"NOT_FOUND","detail":"POST /templates/starter/runs does not exist"} |

## T-retired-instantiate

cannot execute template directly /templates/starter/instantiate

**PASS** — expected: 404; no execution endpoint

Observed assertion result: {"type":"https://graphgoblin.dev/problems/not-found","title":"not found","status":404,"code":"NOT_FOUND","detail":"POST /templates/starter/instantiate does not exist"}

| Request                                    | HTTP | Response excerpt                                                                   |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------- |
| H1219: POST /templates/starter/instantiate | 404  | {"code":"NOT_FOUND","detail":"POST /templates/starter/instantiate does not exist"} |

## T-retired-instance

cannot execute template directly /template-instances

**PASS** — expected: 404; no execution endpoint

Observed assertion result: {"type":"https://graphgoblin.dev/problems/not-found","title":"not found","status":404,"code":"NOT_FOUND","detail":"POST /template-instances does not exist"}

| Request                         | HTTP | Response excerpt                                                        |
| ------------------------------- | ---- | ----------------------------------------------------------------------- |
| H1220: POST /template-instances | 404  | {"code":"NOT_FOUND","detail":"POST /template-instances does not exist"} |

## T-unknown

unknown template draft

**PASS** — expected: 404 TEMPLATE_NOT_FOUND

Observed assertion result: {"type":"https://graphgoblin.dev/problems/template-not-found","title":"template not found","status":404,"code":"TEMPLATE_NOT_FOUND","detail":"This template is not registered."}

| Request                                        | HTTP | Response excerpt                                                          |
| ---------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| H1221: POST /templates/qa-does-not-exist/draft | 404  | {"code":"TEMPLATE_NOT_FOUND","detail":"This template is not registered."} |

## T-invalid-name

blank copied draft name

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/name","message":"must not be blank"}]}

| Request                              | HTTP | Response excerpt                                                                                                                       |
| ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| H1222: POST /templates/starter/draft | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/name","message":"must not be blank"}],"detail":"the request did not match the schema"} |

## D-cascade

deleting a terminal loop removes all its runs and projections

**PASS** — expected: 204; loop/version/export and run/thread/events 404; run list empty

Observed assertion result: {"deleteStatus":204,"checks":[{"path":"/loops/01M52386HCTGZ2HCV2F7ZQQJBW","status":404,"code":"LOOP_NOT_FOUND"},{"path":"/loops/01M52386HCTGZ2HCV2F7ZQQJBW/versions","status":404,"code":"LOOP_NOT_FOUND"},{"path":"/loops/01M52386HCTGZ2HCV2F7ZQQJBW/export","status":404,"code":"LOOP_NOT_FOUND"},{"path":"/runs/01M52386HYR7TQQVVFK4QMYR32","status":404,"code":"RUN_NOT_FOUND"},{"path":"/runs/01M52386HYR7TQQVVFK4QMYR32/thread","status":404,"code":"RUN_NOT_FOUND"},{"path":"/runs/01M52386HYR7TQQVVFK4QMYR32/events","status":404,"code":"RUN_NOT_FOUND"},{"path":"/runs/01M52386JA7Z40ZSA6FWW14907","status":404,"code":"RUN_NOT_FOUND"},{"path":"/runs/01M52386JA7Z40ZSA6FWW14907/thread","status":404,"code":"RUN_NOT_FOUND"},{"path":"/runs/01M52386JA7Z40ZSA6FWW14907/events","status":404,"code":"RUN_NOT_FOUND"}]}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1223: POST /loops                                               | 201  | {"loop":{"id":"01M52386HCTGZ2HCV2F7ZQQJBW"},"draft":{"id":"01M52386HCSMHB3PYGNDCWKVGC","schemaVersion":4},"issues":[]}                                                                                              |
| H1224: POST /loops/01M52386HCTGZ2HCV2F7ZQQJBW/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1225: POST /loops/01M52386HCTGZ2HCV2F7ZQQJBW/runs               | 202  | {"run":{"id":"01M52386HYR7TQQVVFK4QMYR32","ownerId":"local","loopId":"01M52386HCTGZ2HCV2F7ZQQJBW","versionId":"01M52386HCSMHB3PYGNDCWKVGC","invocationId":"01M52386HY3WQRG5XW0916F32B","status":"queued","iteratio… |
| H1226: POST /loops/01M52386HCTGZ2HCV2F7ZQQJBW/runs               | 202  | {"run":{"id":"01M52386JA7Z40ZSA6FWW14907","ownerId":"local","loopId":"01M52386HCTGZ2HCV2F7ZQQJBW","versionId":"01M52386HCSMHB3PYGNDCWKVGC","invocationId":"01M52386JAF2339YZ8CZPXS3WX","status":"queued","iteratio… |
| H1227: GET /runs/01M52386HYR7TQQVVFK4QMYR32                      | 200  | {"id":"01M52386HYR7TQQVVFK4QMYR32","ownerId":"local","loopId":"01M52386HCTGZ2HCV2F7ZQQJBW","versionId":"01M52386HCSMHB3PYGNDCWKVGC","invocationId":"01M52386HY3WQRG5XW0916F32B","status":"running","currentNodeId"… |
| H1228: GET /runs/01M52386HYR7TQQVVFK4QMYR32                      | 200  | {"status":"succeeded","outcome":"success","result":{"n":1}}                                                                                                                                                         |
| H1229: GET /runs/01M52386JA7Z40ZSA6FWW14907                      | 200  | {"status":"succeeded","outcome":"success","result":{"n":2}}                                                                                                                                                         |
| H1230: DELETE /loops/01M52386HCTGZ2HCV2F7ZQQJBW                  | 204  |                                                                                                                                                                                                                     |
| H1231: GET /loops/01M52386HCTGZ2HCV2F7ZQQJBW                     | 404  | {"code":"LOOP_NOT_FOUND","detail":"loop 01M52386HCTGZ2HCV2F7ZQQJBW not found"}                                                                                                                                      |
| H1232: GET /loops/01M52386HCTGZ2HCV2F7ZQQJBW/versions            | 404  | {"code":"LOOP_NOT_FOUND","detail":"loop 01M52386HCTGZ2HCV2F7ZQQJBW not found"}                                                                                                                                      |
| H1233: GET /loops/01M52386HCTGZ2HCV2F7ZQQJBW/export              | 404  | {"code":"LOOP_NOT_FOUND","detail":"loop 01M52386HCTGZ2HCV2F7ZQQJBW not found"}                                                                                                                                      |
| H1234: GET /runs/01M52386HYR7TQQVVFK4QMYR32                      | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386HYR7TQQVVFK4QMYR32 not found"}                                                                                                                                        |
| H1235: GET /runs/01M52386HYR7TQQVVFK4QMYR32/thread               | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386HYR7TQQVVFK4QMYR32 not found"}                                                                                                                                        |
| H1236: GET /runs/01M52386HYR7TQQVVFK4QMYR32/events               | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386HYR7TQQVVFK4QMYR32 not found"}                                                                                                                                        |
| H1237: GET /runs/01M52386JA7Z40ZSA6FWW14907                      | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386JA7Z40ZSA6FWW14907 not found"}                                                                                                                                        |
| H1238: GET /runs/01M52386JA7Z40ZSA6FWW14907/thread               | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386JA7Z40ZSA6FWW14907 not found"}                                                                                                                                        |
| H1239: GET /runs/01M52386JA7Z40ZSA6FWW14907/events               | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52386JA7Z40ZSA6FWW14907 not found"}                                                                                                                                        |
| H1240: GET /runs?loopId=01M52386HCTGZ2HCV2F7ZQQJBW&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |

## D-active-waiting-paused

deletion refuses waiting and paused active run

**PASS** — expected: 409 LOOP_IN_USE in both states; loop/run remain; cancel then delete 204

Observed assertion result: {"waiting":{"type":"https://graphgoblin.dev/problems/loop-in-use","title":"loop in use","status":409,"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"},"paused":{"type":"https://graphgoblin.dev/problems/loop-in-use","title":"loop in use","status":409,"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"},"afterCancel":204}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1241: POST /loops                                    | 201  | {"loop":{"id":"01M52386QCD9RQ34QXC1YS349W"},"draft":{"id":"01M52386QC645RWDWG92V4C75Z","schemaVersion":4},"issues":[]}                                                                                              |
| H1242: POST /loops/01M52386QCD9RQ34QXC1YS349W/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1243: POST /loops/01M52386QCD9RQ34QXC1YS349W/runs    | 202  | {"run":{"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"queued","iteratio… |
| H1244: GET /runs/01M52386QX37X1BDFHVN68MBHS           | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"running","iteration":1,"… |
| H1245: GET /runs/01M52386QX37X1BDFHVN68MBHS           | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"waiting","currentNodeId"… |
| H1246: DELETE /loops/01M52386QCD9RQ34QXC1YS349W       | 409  | {"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"}                                                                                                                                       |
| H1247: GET /loops/01M52386QCD9RQ34QXC1YS349W          | 200  | {"loop":{"id":"01M52386QCD9RQ34QXC1YS349W","currentVersionId":"01M52386QC645RWDWG92V4C75Z"},"draft":{}}                                                                                                             |
| H1248: POST /runs/01M52386QX37X1BDFHVN68MBHS/pause    | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"paused","currentNodeId":… |
| H1249: GET /runs/01M52386QX37X1BDFHVN68MBHS           | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"paused","currentNodeId":… |
| H1250: DELETE /loops/01M52386QCD9RQ34QXC1YS349W       | 409  | {"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"}                                                                                                                                       |
| H1251: GET /runs/01M52386QX37X1BDFHVN68MBHS           | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"paused","currentNodeId":… |
| H1252: POST /runs/01M52386QX37X1BDFHVN68MBHS/cancel   | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"cancelled","currentNodeI… |
| H1253: GET /runs/01M52386QX37X1BDFHVN68MBHS           | 200  | {"id":"01M52386QX37X1BDFHVN68MBHS","ownerId":"local","loopId":"01M52386QCD9RQ34QXC1YS349W","versionId":"01M52386QC645RWDWG92V4C75Z","invocationId":"01M52386QX54HTPR1R9JTF00TM","status":"cancelled","currentNodeI… |
| H1254: DELETE /loops/01M52386QCD9RQ34QXC1YS349W       | 204  |                                                                                                                                                                                                                     |

## D-active-running

deletion refuses a running script

**PASS** — expected: 409 LOOP_IN_USE while running; cancel before deleting

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-in-use","title":"loop in use","status":409,"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1255: POST /loops                                    | 201  | {"loop":{"id":"01M52386X8PB5HNS4309YVHEY9"},"draft":{"id":"01M52386X8ZGWCPF15BSQMXBX2","schemaVersion":4},"issues":[]}                                                                                              |
| H1256: POST /loops/01M52386X8PB5HNS4309YVHEY9/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1257: POST /loops/01M52386X8PB5HNS4309YVHEY9/runs    | 202  | {"run":{"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"queued","iteratio… |
| H1258: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"queued","iteration":1,"c… |
| H1259: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"running","currentNodeId"… |
| H1260: DELETE /loops/01M52386X8PB5HNS4309YVHEY9       | 409  | {"code":"LOOP_IN_USE","detail":"the loop has active runs; cancel them first"}                                                                                                                                       |
| H1261: POST /runs/01M52386XQ2RXH9YJ6XZ7TTY00/cancel   | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"running","currentNodeId"… |
| H1262: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"running","currentNodeId"… |
| H1263: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"running","currentNodeId"… |
| H1264: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"running","currentNodeId"… |
| H1265: GET /runs/01M52386XQ2RXH9YJ6XZ7TTY00           | 200  | {"id":"01M52386XQ2RXH9YJ6XZ7TTY00","ownerId":"local","loopId":"01M52386X8PB5HNS4309YVHEY9","versionId":"01M52386X8ZGWCPF15BSQMXBX2","invocationId":"01M52386XQMVF6N13GPHPKRWVZ","status":"cancelled","currentNodeI… |
| H1266: DELETE /loops/01M52386X8PB5HNS4309YVHEY9       | 204  |                                                                                                                                                                                                                     |

## D-hook-history

deleting webhook loop removes runs/receipts/endpoints

**PASS** — expected: 204; hook 404, runs removed, Events rows absent

Observed assertion result: {"deleteStatus":204,"hook":{"type":"https://graphgoblin.dev/problems/hook-not-found","title":"hook not found","status":404,"code":"HOOK_NOT_FOUND","detail":"unknown webhook"},"runId":"01M52387DMQD4E44V45E4G9M8J"}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1267: POST /loops                                               | 201  | {"loop":{"id":"01M52387CZSF5N32D4369ZY1FP"},"draft":{"id":"01M52387CZSNW3E3VVBKJV6CJW","schemaVersion":4},"issues":[]}                                                                                              |
| H1268: POST /loops/01M52387CZSF5N32D4369ZY1FP/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1269: GET /loops/01M52387CZSF5N32D4369ZY1FP/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M52387DAAN4K546ZT4E9G9GV","ownerId":"local","loopId":"01M52387CZSF5N32D4369ZY1FP","versionId":"01M52387CZSNW3E3VVBKJV6CJW","triggerNodeId":"start","path":"/hooks/6_nxP5drfnz…  |
| [H1270: POST /hooks/6_nxP5drfnz4gyvcEYnl-wClyuXrh2UASdg13zDCyYM  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1271: GET /runs?loopId=01M52387CZSF5N32D4369ZY1FP&amp;limit=500 | 200  | {"items":{"id":"01M52387DMQD4E44V45E4G9M8J","ownerId":"local","loopId":"01M52387CZSF5N32D4369ZY1FP","versionId":"01M52387CZSNW3E3VVBKJV6CJW","invocationId":"01M52387DMFFHP5PPFG1YH0DJM","status":"queued","itera…  |
| [H1272: GET /runs/01M52387DMQD4E44V45E4G9M8J                     | 200  | {"id":"01M52387DMQD4E44V45E4G9M8J","ownerId":"local","loopId":"01M52387CZSF5N32D4369ZY1FP","versionId":"01M52387CZSNW3E3VVBKJV6CJW","invocationId":"01M52387DMFFHP5PPFG1YH0DJM","status":"running","iteration":1,"… |
| H1273: GET /runs/01M52387DMQD4E44V45E4G9M8J                      | 200  | {"status":"succeeded","outcome":"success","result":{"qa":"delete hook"}}                                                                                                                                            |
| H1274: GET /events?limit=200                                     | 200  | {"items":{"id":"01M52387DMV59QRDXV4B3064EM","ownerId":"local","type":"webhook","payload":{"qa":"delete hook"},"source":"webhook:01M52387DAAN4K546ZT4E9G9GV","receivedAt":"2026-10-16T10:13:48.595Z","runIds":["01…  |
| [H1275: DELETE /loops/01M52387CZSF5N32D4369ZY1FP                 | 204  |                                                                                                                                                                                                                     |
| H1276: POST /hooks/6_nxP5drfnz4gyvcEYnl-wClyuXrh2UASdg13zDCyYM   | 404  | {"code":"HOOK_NOT_FOUND","detail":"unknown webhook"}                                                                                                                                                                |
| H1277: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M52387DMV59QRDXV4B3064EM","ownerId":"local","type":"webhook","payload":{"qa":"delete hook"},"source":"webhook:01M52387DAAN4K546ZT4E9G9GV","receivedAt":"2026-10-16T10:13:48.595Z","runIds":[]},… |
| H1278: GET /runs/01M52387DMQD4E44V45E4G9M8J                      | 404  | {"code":"RUN_NOT_FOUND","detail":"run 01M52387DMQD4E44V45E4G9M8J not found"}                                                                                                                                        |

## D-missing

deleting a missing loop

**PASS** — expected: 404 LOOP_NOT_FOUND

Observed assertion result: {"type":"https://graphgoblin.dev/problems/loop-not-found","title":"loop not found","status":404,"code":"LOOP_NOT_FOUND","detail":"loop 01M52387MBZPSBB5GMB6JWPVFF not found"}

| Request                                         | HTTP | Response excerpt                                                                                                       |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| H1279: POST /loops                              | 201  | {"loop":{"id":"01M52387MBZPSBB5GMB6JWPVFF"},"draft":{"id":"01M52387MBV3DXG2JFWJ94XNE6","schemaVersion":4},"issues":[]} |
| H1280: DELETE /loops/01M52387MBZPSBB5GMB6JWPVFF | 204  |                                                                                                                        |
| H1281: DELETE /loops/01M52387MBZPSBB5GMB6JWPVFF | 404  | {"code":"LOOP_NOT_FOUND","detail":"loop 01M52387MBZPSBB5GMB6JWPVFF not found"}                                         |

## W-boundary-escaped-array-pointer

escaped-array-pointer

**PASS** — expected: 202; eventType=escaped-event

Observed assertion result: {"ack":{"accepted":true},"trigger":{"nodeId":"start","kind":"webhook","payload":{"a/b":{"~key":["escaped-event"]}},"receivedAt":"2026-10-16T10:14:46.592Z","eventType":"escaped-event"}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1282: POST /loops                                               | 201  | {"loop":{"id":"01M523A0164FQ3EGCBS03DKENY"},"draft":{"id":"01M523A01640RZMKNNNG4RMT03","schemaVersion":4},"issues":[]}                                                                                              |
| H1283: POST /loops/01M523A0164FQ3EGCBS03DKENY/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1284: GET /loops/01M523A0164FQ3EGCBS03DKENY/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523A01N7XNV538CG77HFJ2Q","ownerId":"local","loopId":"01M523A0164FQ3EGCBS03DKENY","versionId":"01M523A01640RZMKNNNG4RMT03","triggerNodeId":"start","path":"/hooks/R-ZiiIgqmqO…  |
| [H1285: POST /hooks/R-ZiiIgqmqOaCGO8nrsecSvTZo0YpTBIynbW1OJs42U  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1286: GET /runs?loopId=01M523A0164FQ3EGCBS03DKENY&amp;limit=500 | 200  | {"items":{"id":"01M523A0206VVBBMSF8KPQF717","ownerId":"local","loopId":"01M523A0164FQ3EGCBS03DKENY","versionId":"01M523A01640RZMKNNNG4RMT03","invocationId":"01M523A0201K4294NQFDMPDTXA","status":"queued","itera…  |
| [H1287: GET /runs/01M523A0206VVBBMSF8KPQF717/thread              | 200  | {"schemaVersion":1,"run":{"id":"01M523A0206VVBBMSF8KPQF717","loopId":"01M523A0164FQ3EGCBS03DKENY","versionId":"01M523A01640RZMKNNNG4RMT03","iteration":1},"invocation":{"id":"01M523A0201K4294NQFDMPDTXA","source"… |

## W-boundary-root-scalar-pointer

root-scalar-pointer

**PASS** — expected: 202; eventType=true

Observed assertion result: {"ack":{"accepted":true},"trigger":{"nodeId":"start","kind":"webhook","payload":true,"receivedAt":"2026-10-16T10:14:46.651Z","eventType":"true"}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1288: POST /loops                                               | 201  | {"loop":{"id":"01M523A02V9H6MRQ9TMP3NE1CK"},"draft":{"id":"01M523A02VRNMTVAKVY67BK2AV","schemaVersion":4},"issues":[]}                                                                                              |
| H1289: POST /loops/01M523A02V9H6MRQ9TMP3NE1CK/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1290: GET /loops/01M523A02V9H6MRQ9TMP3NE1CK/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523A03GDH35PCRQ7VCTR1BQ","ownerId":"local","loopId":"01M523A02V9H6MRQ9TMP3NE1CK","versionId":"01M523A02VRNMTVAKVY67BK2AV","triggerNodeId":"start","path":"/hooks/sQZZ5Fj2pHZ…  |
| [H1291: POST /hooks/sQZZ5Fj2pHZHDBVaZWcz73-_yhr3TFLNV67_lKxYOmM  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1292: GET /runs?loopId=01M523A02V9H6MRQ9TMP3NE1CK&amp;limit=500 | 200  | {"items":{"id":"01M523A03V4TP5ZSK7RV744581","ownerId":"local","loopId":"01M523A02V9H6MRQ9TMP3NE1CK","versionId":"01M523A02VRNMTVAKVY67BK2AV","invocationId":"01M523A03V83Z9ASJ6FAXMM9P7","status":"running","iter…  |
| [H1293: GET /runs/01M523A03V4TP5ZSK7RV744581/thread              | 200  | {"schemaVersion":1,"run":{"id":"01M523A03V4TP5ZSK7RV744581","loopId":"01M523A02V9H6MRQ9TMP3NE1CK","versionId":"01M523A02VRNMTVAKVY67BK2AV","iteration":1},"invocation":{"id":"01M523A03V83Z9ASJ6FAXMM9P7","source"… |

## W-boundary-own-property-pointer

own-property-pointer

**PASS** — expected: 202; eventType=fallback

Observed assertion result: {"ack":{"accepted":true},"trigger":{"nodeId":"start","kind":"webhook","payload":{},"receivedAt":"2026-10-16T10:14:46.708Z","eventType":"fallback"}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1294: POST /loops                                               | 201  | {"loop":{"id":"01M523A04SQXCFTBNDWQZ9TB5K"},"draft":{"id":"01M523A04SGTMNFD1G72WY4WW3","schemaVersion":4},"issues":[]}                                                                                              |
| H1295: POST /loops/01M523A04SQXCFTBNDWQZ9TB5K/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1296: GET /loops/01M523A04SQXCFTBNDWQZ9TB5K/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523A05AG3MYZ7Q2SJJFYRJV","ownerId":"local","loopId":"01M523A04SQXCFTBNDWQZ9TB5K","versionId":"01M523A04SGTMNFD1G72WY4WW3","triggerNodeId":"start","path":"/hooks/pJ1yRNnoqQt…  |
| [H1297: POST /hooks/pJ1yRNnoqQtc8nbdRzNJO6gk5DPLoaoc3n-tWviuE-U  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1298: GET /runs?loopId=01M523A04SQXCFTBNDWQZ9TB5K&amp;limit=500 | 200  | {"items":{"id":"01M523A05MMTDK13SA7A7NF0GJ","ownerId":"local","loopId":"01M523A04SQXCFTBNDWQZ9TB5K","versionId":"01M523A04SGTMNFD1G72WY4WW3","invocationId":"01M523A05MQS1M7R2FH9HCE5M5","status":"running","iter…  |
| [H1299: GET /runs/01M523A05MMTDK13SA7A7NF0GJ/thread              | 200  | {"schemaVersion":1,"run":{"id":"01M523A05MMTDK13SA7A7NF0GJ","loopId":"01M523A04SQXCFTBNDWQZ9TB5K","versionId":"01M523A04SGTMNFD1G72WY4WW3","iteration":1},"invocation":{"id":"01M523A05MQS1M7R2FH9HCE5M5","source"… |

## W-key-undefined

undefined expression key

**PASS** — expected: 422 KEY_INVALID with no stored receipt or run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/key-invalid","title":"key invalid","status":422,"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1300: POST /loops                                               | 201  | {"loop":{"id":"01M523A06VEQNXS5QS2Y9JH51W"},"draft":{"id":"01M523A06V2B25FYDAZ0FVDK7Z","schemaVersion":4},"issues":[]}                                                                                              |
| H1301: POST /loops/01M523A06VEQNXS5QS2Y9JH51W/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1302: GET /loops/01M523A06VEQNXS5QS2Y9JH51W/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523A075Z4MA8VDJRCB4BAME","ownerId":"local","loopId":"01M523A06VEQNXS5QS2Y9JH51W","versionId":"01M523A06V2B25FYDAZ0FVDK7Z","triggerNodeId":"start","path":"/hooks/3cDdatkIgI9…  |
| [H1303: POST /hooks/3cDdatkIgI9XJJEy5qkCfAMZ6x2fKchkrwWtRBaPexo  | 422  | {"code":"KEY_INVALID","detail":"the webhook key must be nonempty and at most 512 characters"}                                                                                                                       |
| H1304: GET /runs?loopId=01M523A06VEQNXS5QS2Y9JH51W&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                      |
| H1305: GET /events?limit=200                                     | 200  | {"items":[{"id":"01M523A05M48GXE2CV7FK0A05X","ownerId":"local","type":"webhook","payload":{},"source":"webhook:01M523A05AG3MYZ7Q2SJJFYRJV","receivedAt":"2026-10-16T10:14:46.707Z","runIds":["01M523A05MMTDK13SA7A… |

## W-key-whitespace

whitespace keys remain literal

**PASS** — expected: space and two-space create distinct runs; repeated space deduplicates

Observed assertion result: {"runCount":2,"keys":[" "," "]}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1306: POST /loops                                                | 201  | {"loop":{"id":"01M523A08VH5X3632VZS7JZGSH"},"draft":{"id":"01M523A08VXQJ9TY2PJFTNNA1A","schemaVersion":4},"issues":[]}                                                                                              |
| H1307: POST /loops/01M523A08VH5X3632VZS7JZGSH/publish             | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1308: GET /loops/01M523A08VH5X3632VZS7JZGSH/triggers             | 200  | {"schedules":[],"webhooks":{"id":"01M523A097QH1GH7FSHCW71776","ownerId":"local","loopId":"01M523A08VH5X3632VZS7JZGSH","versionId":"01M523A08VXQJ9TY2PJFTNNA1A","triggerNodeId":"start","path":"/hooks/dlRH490VQ39…  |
| [H1309: POST /hooks/dlRH490VQ39qbmAfQd0nQALYiw_N8Z8uyKDLYy2hPDU   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1310: POST /hooks/dlRH490VQ39qbmAfQd0nQALYiw_N8Z8uyKDLYy2hPDU    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1311: POST /hooks/dlRH490VQ39qbmAfQd0nQALYiw_N8Z8uyKDLYy2hPDU    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1312: GET /runs?loopId=01M523A08VH5X3632VZS7JZGSH&amp;limit=500  | 200  | {"items":{"id":"01M523A09Z8QY6S17C4B7346TY","ownerId":"local","loopId":"01M523A08VH5X3632VZS7JZGSH","versionId":"01M523A08VXQJ9TY2PJFTNNA1A","invocationId":"01M523A09ZXMZASS2YG5YP35PE","status":"running","iter…  |
| [H1313: GET /runs?loopId=01M523A08VH5X3632VZS7JZGSH&amp;limit=500 | 200  | {"items":{"id":"01M523A09Z8QY6S17C4B7346TY","ownerId":"local","loopId":"01M523A08VH5X3632VZS7JZGSH","versionId":"01M523A08VXQJ9TY2PJFTNNA1A","invocationId":"01M523A09ZXMZASS2YG5YP35PE","status":"succeeded","it…  |
| [H1314: GET /runs/01M523A09Z8QY6S17C4B7346TY/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M523A09Z8QY6S17C4B7346TY","loopId":"01M523A08VH5X3632VZS7JZGSH","versionId":"01M523A08VXQJ9TY2PJFTNNA1A","iteration":1},"invocation":{"id":"01M523A09ZXMZASS2YG5YP35PE","source"… |
| H1315: GET /runs/01M523A09HDPQSRGNRE6MQVDQV/thread                | 200  | {"schemaVersion":1,"run":{"id":"01M523A09HDPQSRGNRE6MQVDQV","loopId":"01M523A08VH5X3632VZS7JZGSH","versionId":"01M523A08VXQJ9TY2PJFTNNA1A","iteration":1},"invocation":{"id":"01M523A09H4ZXFVACBAWMKG31Q","source"… |

## W-key-non-string

object key uses JSON representation

**PASS** — expected: 202, then deduplicated repeat; stored exact JSON key

Observed assertion result: {"count":1,"key":"{\"business\":7}"}

| Request                                                           | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1316: POST /loops                                                | 201  | {"loop":{"id":"01M523A0FWJ9N2W6C3S7JD9AH9"},"draft":{"id":"01M523A0FWS7BHC7YAWER8GJ3A","schemaVersion":4},"issues":[]}                                                                                              |
| H1317: POST /loops/01M523A0FWJ9N2W6C3S7JD9AH9/publish             | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1318: GET /loops/01M523A0FWJ9N2W6C3S7JD9AH9/triggers             | 200  | {"schedules":[],"webhooks":{"id":"01M523A0G651B8H2NVJHRK9G6Q","ownerId":"local","loopId":"01M523A0FWJ9N2W6C3S7JD9AH9","versionId":"01M523A0FWS7BHC7YAWER8GJ3A","triggerNodeId":"start","path":"/hooks/WG-nz0Iy9do…  |
| [H1319: POST /hooks/WG-nz0Iy9doOjlI1q_Io2sldaqaSMVTwxvlkCOqqr5o   | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1320: POST /hooks/WG-nz0Iy9doOjlI1q_Io2sldaqaSMVTwxvlkCOqqr5o    | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1321: GET /runs?loopId=01M523A0FWJ9N2W6C3S7JD9AH9&amp;limit=500  | 200  | {"items":{"id":"01M523A0GGZ9Z8KN7X4PVNNE6Y","ownerId":"local","loopId":"01M523A0FWJ9N2W6C3S7JD9AH9","versionId":"01M523A0FWS7BHC7YAWER8GJ3A","invocationId":"01M523A0GGQSPR0AWT243J1VZT","status":"running","curr…  |
| [H1322: GET /runs?loopId=01M523A0FWJ9N2W6C3S7JD9AH9&amp;limit=500 | 200  | {"items":{"id":"01M523A0GGZ9Z8KN7X4PVNNE6Y","ownerId":"local","loopId":"01M523A0FWJ9N2W6C3S7JD9AH9","versionId":"01M523A0FWS7BHC7YAWER8GJ3A","invocationId":"01M523A0GGQSPR0AWT243J1VZT","status":"succeeded","it…  |
| [H1323: GET /runs/01M523A0GGZ9Z8KN7X4PVNNE6Y/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M523A0GGZ9Z8KN7X4PVNNE6Y","loopId":"01M523A0FWJ9N2W6C3S7JD9AH9","versionId":"01M523A0FWS7BHC7YAWER8GJ3A","iteration":1},"invocation":{"id":"01M523A0GGQSPR0AWT243J1VZT","source"… |

## W-key-expression-error

key expression evaluation failure

**PASS** — expected: 422 EXPRESSION_FAILED with no receipt/run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/expression-failed","title":"expression failed","status":422,"code":"EXPRESSION_FAILED","detail":"the webhook dedupe expression failed"}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1324: POST /loops                                               | 201  | {"loop":{"id":"01M523A0PGFT9Z7MKS8TBAC6H8"},"draft":{"id":"01M523A0PG9HSEZKEH93BM8VCC","schemaVersion":4},"issues":[]}                                                                                             |
| H1325: POST /loops/01M523A0PGFT9Z7MKS8TBAC6H8/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H1326: GET /loops/01M523A0PGFT9Z7MKS8TBAC6H8/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523A0PVJ1W9S4CVPV37HKEW","ownerId":"local","loopId":"01M523A0PGFT9Z7MKS8TBAC6H8","versionId":"01M523A0PG9HSEZKEH93BM8VCC","triggerNodeId":"start","path":"/hooks/YRICzD0UE0D… |
| [H1327: POST /hooks/YRICzD0UE0DUhnyLD2qiQdNgG8SB2GXGOh_0DycnpW8  | 422  | {"code":"EXPRESSION_FAILED","detail":"the webhook dedupe expression failed"}                                                                                                                                       |
| H1328: GET /runs?loopId=01M523A0PGFT9Z7MKS8TBAC6H8&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## W-auth-before-json

authentication precedes JSON decoding with configured secret

**PASS** — expected: 401 SIGNATURE_INVALID for unsigned malformed JSON; correctly signed malformed JSON gives 400 BODY_INVALID

Observed assertion result: {"unsigned":{"type":"https://graphgoblin.dev/problems/signature-invalid","title":"signature invalid","status":401,"code":"SIGNATURE_INVALID","detail":"the signature does not match"},"signed":{"type":"https://graphgoblin.dev/problems/body-invalid","title":"body invalid","status":400,"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1386: POST /loops                                               | 201  | {"loop":{"id":"01M523BX11M6SDRCAF7K0K3CPG"},"draft":{"id":"01M523BX11PFTJAYS7RJVR7XN1","schemaVersion":4},"issues":[]}                                                                                             |
| H1387: POST /loops/01M523BX11M6SDRCAF7K0K3CPG/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H1388: GET /loops/01M523BX11M6SDRCAF7K0K3CPG/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523BX1F5TFY2XQYX0HWNQKV","ownerId":"local","loopId":"01M523BX11M6SDRCAF7K0K3CPG","versionId":"01M523BX11PFTJAYS7RJVR7XN1","triggerNodeId":"start","path":"/hooks/OtXtRcUxTQe… |
| [H1389: POST /hooks/OtXtRcUxTQeRpWImirCo2sR_e1Kh7XWqbk15S1FrR8I  | 401  | {"code":"SIGNATURE_INVALID","detail":"the signature does not match"}                                                                                                                                               |
| H1390: POST /hooks/OtXtRcUxTQeRpWImirCo2sR_e1Kh7XWqbk15S1FrR8I   | 400  | {"code":"BODY_INVALID","detail":"the body is not valid UTF-8 or JSON"}                                                                                                                                             |
| H1391: GET /runs?loopId=01M523BX11M6SDRCAF7K0K3CPG&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## W-config-bad-header

reject bad-header

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/authentication/header","message":"Invalid string: must match pattern /^[!#$%&'*+.^_`|~0-9a-z-]+$/"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                                         |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1333: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/authentication/header","message":"Invalid string: must match pattern /^[!#$%&amp;'*+.^_'\|~0-9a-z-]+$/"}],"detail":"the request did not match… |

## W-config-zero-window

reject zero-window

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/authentication/windowSeconds","message":"Too small: expected number to be >=1"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                               |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1334: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/authentication/windowSeconds","message":"Too small: expected number to be &gt;=1"}],"detail":"the request did not match the schema"} |

## W-config-bad-pointer

reject bad-pointer

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/eventType/pointer","message":"Invalid string: must match pattern /^(?:\\/(?:[^~]|~[01])*)?$/"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                                     |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1335: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/eventType/pointer","message":"Invalid string: must match pattern /^(?:\\/(?:[^~]\|~[01])*)?$/"}],"detail":"the request did not match the … |

## W-config-control-constant

reject control-constant

**PASS** — expected: 400 VALIDATION_FAILED

Observed assertion result: {"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/definition/nodes/0/config/eventType/value","message":"Invalid string: must match pattern /^(?!\\s*$)[^\\u0000-\\u001f\\u007f-\\u009f]+$/u"}]}

| Request            | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1336: POST /loops | 400  | {"code":"VALIDATION_FAILED","errors":[{"path":"/definition/nodes/0/config/eventType/value","message":"Invalid string: must match pattern /^(?!\\s*$)[^\\u0000-\\u001f\\u007f-\\u009f]+$/u"}],"detail":"the request… |

## G-output-shape

expression output uses current evidence shape

**PASS** — expected: thread decision output has exactly portId/provenance/observation; route confidence/reasoning null

Observed assertion result: {"status":"succeeded","output":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"yes","confidence":null,"reasoning":null},"portId":"yes"}}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1337: POST /loops                                    | 201  | {"loop":{"id":"01M523A0RKMFCMSMNV1ECVQE68"},"draft":{"id":"01M523A0RKB68EFSYCSA9XN9S3","schemaVersion":4},"issues":[]}                                                                                              |
| H1338: POST /loops/01M523A0RKMFCMSMNV1ECVQE68/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1339: POST /loops/01M523A0RKMFCMSMNV1ECVQE68/runs    | 202  | {"run":{"id":"01M523A0S2QJJFBX7Q1JV6MVX5","ownerId":"local","loopId":"01M523A0RKMFCMSMNV1ECVQE68","versionId":"01M523A0RKB68EFSYCSA9XN9S3","invocationId":"01M523A0S29ZE600K2JGFNPM8G","status":"queued","iteratio… |
| H1340: GET /runs/01M523A0S2QJJFBX7Q1JV6MVX5           | 200  | {"id":"01M523A0S2QJJFBX7Q1JV6MVX5","ownerId":"local","loopId":"01M523A0RKMFCMSMNV1ECVQE68","versionId":"01M523A0RKB68EFSYCSA9XN9S3","invocationId":"01M523A0S29ZE600K2JGFNPM8G","status":"running","iteration":1,"… |
| H1341: GET /runs/01M523A0S2QJJFBX7Q1JV6MVX5           | 200  | {"status":"succeeded","outcome":"success","result":{}}                                                                                                                                                              |
| H1342: GET /runs/01M523A0S2QJJFBX7Q1JV6MVX5/thread    | 200  | {"schemaVersion":1,"run":{"id":"01M523A0S2QJJFBX7Q1JV6MVX5","loopId":"01M523A0RKMFCMSMNV1ECVQE68","versionId":"01M523A0RKB68EFSYCSA9XN9S3","iteration":1},"invocation":{"id":"01M523A0S29ZE600K2JGFNPM8G","source"… |

## G-wait-time

gate time includes a parked duration wait

**PASS** — expected: after two-second wait, repeat blocked by one-second run-time limit at pass 1

Observed assertion result: {"status":"exhausted","result":1,"decision":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"limit-reached","gate":{"previousPasses":1,"passes":1,"repeatRouteId":"again","maxPasses":8,"maxRunTimeSeconds":1,"elapsedSeconds":2.974,"limit":"max-run-time"},"diagnostics":[],"runId":"01M523A0XR9CNEN7X5GWD3SY0S","seq":11,"ts":"2026-10-16T10:14:50.461Z","type":"decision.made","nodeId":"gate"},"resume":{"type":"https://graphgoblin.dev/problems/invalid-state","title":"invalid state","status":409,"code":"INVALID_STATE","detail":"cannot resume a run that is exhausted"}}

| Request                                                                 | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1343: POST /loops                                                      | 201  | {"loop":{"id":"01M523A0X84GCV06ME2G1YYDCQ"},"draft":{"id":"01M523A0X8HVV115GPQADRY52C","schemaVersion":4},"issues":[]}                                                                                              |
| H1344: POST /loops/01M523A0X84GCV06ME2G1YYDCQ/publish                   | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1345: POST /loops/01M523A0X84GCV06ME2G1YYDCQ/runs                      | 202  | {"run":{"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"queued","iteratio… |
| H1346: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"running","iteration":1,"… |
| H1347: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1348: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1349: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1350: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1351: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1352: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1353: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1354: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1355: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1356: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1357: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1358: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1359: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1360: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1361: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1362: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1363: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1364: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1365: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1366: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1367: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1368: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1369: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1370: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1371: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1372: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1373: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"waiting","currentNodeId"… |
| H1374: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S                             | 200  | {"status":"exhausted","outcome":"exhausted","result":1}                                                                                                                                                             |
| H1375: GET /runs/01M523A0XR9CNEN7X5GWD3SY0S/events                      | 200  | {"items":{"runId":"01M523A0XR9CNEN7X5GWD3SY0S","seq":1,"ts":"2026-10-16T10:14:47.480Z","type":"run.queued","initialThread":{"schemaVersion":1,"run":{"id":"01M523A0XR9CNEN7X5GWD3SY0S","loopId":"01M523A0X84GCV06…  |
| [H1376: POST /runs/01M523A0XR9CNEN7X5GWD3SY0S/resume                    | 409  | {"code":"INVALID_STATE","detail":"cannot resume a run that is exhausted"}                                                                                                                                           |
| H1377: GET /runs?loopId=01M523A0X84GCV06ME2G1YYDCQ&amp;status=exhausted | 200  | {"items":{"id":"01M523A0XR9CNEN7X5GWD3SY0S","ownerId":"local","loopId":"01M523A0X84GCV06ME2G1YYDCQ","versionId":"01M523A0X8HVV115GPQADRY52C","invocationId":"01M523A0XRAQ94WNFDHBKGC3FR","status":"exhausted","it…  |

## ENV-instance

QA instance responds on the designated port

**PASS** — expected: health 200; version 200; OpenAPI and docs 200

Observed assertion result: {"health":{"status":"ok"},"version":{"name":"graphgoblin-api","version":"0.1.0"},"openapiStatus":200,"docsStatus":200}

| Request                  | HTTP | Response excerpt                                                                                                                                                                                                    |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [H1381: GET /healthz     | 200  | {"status":"ok"}                                                                                                                                                                                                     |
| H1382: GET /version      | 200  | {"name":"graphgoblin-api","version":"0.1.0"}                                                                                                                                                                        |
| H1383: GET /openapi.json | 200  | {"openapi":"3.1.0","info":{"title":"GraphGoblin API","version":"0.1.0","description":"Design, run, and observe agent loops. Commands are REST; run state is a snapshot plus an event stream."},"components":{"secu… |
| H1384: GET /docs         | 200  | &lt;!-- HTML for static distribution bundle build --&gt; &lt;!DOCTYPE html&gt; &lt;html lang="en"&gt; &lt;head&gt; &lt;meta charset="UTF-8"&gt; &lt;title&gt;Swagger UI&lt;/title&gt; …                             |

## W-binary-hmac-body

arbitrary binary bytes with body HMAC

**PASS** — expected: 202 and exact base64 payload for non-UTF-8 bytes

Observed assertion result: {"ack":{"accepted":true},"payload":{"encoding":"base64","data":"AP+A/go="}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1392: POST /loops                                               | 201  | {"loop":{"id":"01M523BX28PM1JRRGBFDNDW948"},"draft":{"id":"01M523BX288M43MDZZ9PH76GSN","schemaVersion":4},"issues":[]}                                                                                              |
| H1393: POST /loops/01M523BX28PM1JRRGBFDNDW948/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1394: GET /loops/01M523BX28PM1JRRGBFDNDW948/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523BX2M1K3R2QFFAJXJQ2TH","ownerId":"local","loopId":"01M523BX28PM1JRRGBFDNDW948","versionId":"01M523BX288M43MDZZ9PH76GSN","triggerNodeId":"start","path":"/hooks/pEp0s9mdRoH…  |
| [H1395: POST /hooks/pEp0s9mdRoHG3QYWA3lELFDPtGAPNHNd5mbIWQz-eDk  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1396: GET /runs?loopId=01M523BX28PM1JRRGBFDNDW948&amp;limit=500 | 200  | {"items":{"id":"01M523BX31323EBMT16E2WQXPK","ownerId":"local","loopId":"01M523BX28PM1JRRGBFDNDW948","versionId":"01M523BX288M43MDZZ9PH76GSN","invocationId":"01M523BX312A7YSKS0N6WVT416","status":"running","iter…  |
| [H1397: GET /runs/01M523BX31323EBMT16E2WQXPK                     | 200  | {"id":"01M523BX31323EBMT16E2WQXPK","ownerId":"local","loopId":"01M523BX28PM1JRRGBFDNDW948","versionId":"01M523BX288M43MDZZ9PH76GSN","invocationId":"01M523BX312A7YSKS0N6WVT416","status":"running","currentNodeId"… |
| H1398: GET /runs/01M523BX31323EBMT16E2WQXPK                      | 200  | {"status":"succeeded","outcome":"success","result":{"encoding":"base64","data":"AP+A/go="}}                                                                                                                         |
| H1399: GET /runs/01M523BX31323EBMT16E2WQXPK/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M523BX31323EBMT16E2WQXPK","loopId":"01M523BX28PM1JRRGBFDNDW948","versionId":"01M523BX288M43MDZZ9PH76GSN","iteration":1},"invocation":{"id":"01M523BX312A7YSKS0N6WVT416","source"… |

## W-binary-hmac-timestamp-body

arbitrary binary bytes with timestamp-body HMAC

**PASS** — expected: 202 and exact base64 payload for non-UTF-8 bytes

Observed assertion result: {"ack":{"accepted":true},"payload":{"encoding":"base64","data":"AP+A/go="}}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1400: POST /loops                                               | 201  | {"loop":{"id":"01M523BX7W6R9XYKHNCJJTV86Q"},"draft":{"id":"01M523BX7W25ST72Z170QGHJNE","schemaVersion":4},"issues":[]}                                                                                              |
| H1401: POST /loops/01M523BX7W6R9XYKHNCJJTV86Q/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1402: GET /loops/01M523BX7W6R9XYKHNCJJTV86Q/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523BX8AGW0Y99HWHR8R2S1S","ownerId":"local","loopId":"01M523BX7W6R9XYKHNCJJTV86Q","versionId":"01M523BX7W25ST72Z170QGHJNE","triggerNodeId":"start","path":"/hooks/QsiaW9Ip-3N…  |
| [H1403: POST /hooks/QsiaW9Ip-3NPBT-XQ_OGCeEO7CATQ8d6qW7WamkLi9U  | 202  | {"accepted":true}                                                                                                                                                                                                   |
| H1404: GET /runs?loopId=01M523BX7W6R9XYKHNCJJTV86Q&amp;limit=500 | 200  | {"items":{"id":"01M523BX8RXTJPAMTQ3MMJN0PQ","ownerId":"local","loopId":"01M523BX7W6R9XYKHNCJJTV86Q","versionId":"01M523BX7W25ST72Z170QGHJNE","invocationId":"01M523BX8R0DE09A91GBBC2FWH","status":"running","iter…  |
| [H1405: GET /runs/01M523BX8RXTJPAMTQ3MMJN0PQ                     | 200  | {"id":"01M523BX8RXTJPAMTQ3MMJN0PQ","ownerId":"local","loopId":"01M523BX7W6R9XYKHNCJJTV86Q","versionId":"01M523BX7W25ST72Z170QGHJNE","invocationId":"01M523BX8R0DE09A91GBBC2FWH","status":"running","currentNodeId"… |
| H1406: GET /runs/01M523BX8RXTJPAMTQ3MMJN0PQ                      | 200  | {"status":"succeeded","outcome":"success","result":{"encoding":"base64","data":"AP+A/go="}}                                                                                                                         |
| H1407: GET /runs/01M523BX8RXTJPAMTQ3MMJN0PQ/thread               | 200  | {"schemaVersion":1,"run":{"id":"01M523BX8RXTJPAMTQ3MMJN0PQ","loopId":"01M523BX7W6R9XYKHNCJJTV86Q","versionId":"01M523BX7W25ST72Z170QGHJNE","iteration":1},"invocation":{"id":"01M523BX8R0DE09A91GBBC2FWH","source"… |

## W-secret-not-ready

missing signing secret

**PASS** — expected: 503 HOOK_NOT_READY without creating run

Observed assertion result: {"type":"https://graphgoblin.dev/problems/hook-not-ready","title":"hook not ready","status":503,"code":"HOOK_NOT_READY","detail":"the endpoint has no signing secret configured"}

| Request                                                          | HTTP | Response excerpt                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1408: POST /loops                                               | 201  | {"loop":{"id":"01M523BXD44SNSGHGBRXTNRWWG"},"draft":{"id":"01M523BXD4JNJYJNNHHE5CHN82","schemaVersion":4},"issues":[]}                                                                                             |
| H1409: POST /loops/01M523BXD44SNSGHGBRXTNRWWG/publish            | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                        |
| H1410: GET /loops/01M523BXD44SNSGHGBRXTNRWWG/triggers            | 200  | {"schedules":[],"webhooks":{"id":"01M523BXDG8ZQ2BR7N8Z4A9G7J","ownerId":"local","loopId":"01M523BXD44SNSGHGBRXTNRWWG","versionId":"01M523BXD4JNJYJNNHHE5CHN82","triggerNodeId":"start","path":"/hooks/G3eG0yWn164… |
| [H1411: POST /hooks/G3eG0yWn164DN376bENSpqHs0xcswibdd5Xlsy2bviM  | 503  | {"code":"HOOK_NOT_READY","detail":"the endpoint has no signing secret configured"}                                                                                                                                 |
| H1412: GET /runs?loopId=01M523BXD44SNSGHGBRXTNRWWG&amp;limit=500 | 200  | {"items":[],"nextCursor":null}                                                                                                                                                                                     |

## T-ordinary-runtime

copied template supports ordinary save/publish/run

**PASS** — expected: 201 copy; save replacement graph; publish 200; manual API run succeeds without harness

Observed assertion result: {"loopId":"01M523BXECMEY7QQ7MY4V0QT0Q","runId":"01M523BXF51QJ5JWHFFRF50P7K","status":"succeeded","result":{"templateCopy":true}}

| Request                                               | HTTP | Response excerpt                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1413: POST /templates/starter/draft                  | 201  | {"loop":{"id":"01M523BXECMEY7QQ7MY4V0QT0Q"},"draft":{"id":"01M523BXECDNKYEMTZBDMNJGCB","schemaVersion":4},"issues":[]}                                                                                              |
| H1414: GET /loops/01M523BXECMEY7QQ7MY4V0QT0Q          | 200  | {"loop":{"id":"01M523BXECMEY7QQ7MY4V0QT0Q"},"draft":{"id":"01M523BXECDNKYEMTZBDMNJGCB","schemaVersion":4}}                                                                                                          |
| H1415: PUT /loops/01M523BXECMEY7QQ7MY4V0QT0Q/draft    | 200  | {"draft":{"id":"01M523BXECDNKYEMTZBDMNJGCB","loopId":"01M523BXECMEY7QQ7MY4V0QT0Q","version":1,"status":"draft","definition":{"schemaVersion":4,"name":"f4qa-1792145748767 ordinary replacement","settings":{"worki… |
| H1416: POST /loops/01M523BXECMEY7QQ7MY4V0QT0Q/publish | 200  | {"version":1,"schemaVersion":4,"issues":[]}                                                                                                                                                                         |
| H1417: POST /loops/01M523BXECMEY7QQ7MY4V0QT0Q/runs    | 202  | {"run":{"id":"01M523BXF51QJ5JWHFFRF50P7K","ownerId":"local","loopId":"01M523BXECMEY7QQ7MY4V0QT0Q","versionId":"01M523BXECDNKYEMTZBDMNJGCB","invocationId":"01M523BXF5MDZTK3SBE241B6ER","status":"queued","iteratio… |
| H1418: GET /runs/01M523BXF51QJ5JWHFFRF50P7K           | 200  | {"id":"01M523BXF51QJ5JWHFFRF50P7K","ownerId":"local","loopId":"01M523BXECMEY7QQ7MY4V0QT0Q","versionId":"01M523BXECDNKYEMTZBDMNJGCB","invocationId":"01M523BXF5MDZTK3SBE241B6ER","status":"queued","iteration":1,"c… |
| H1419: GET /runs/01M523BXF51QJ5JWHFFRF50P7K           | 200  | {"status":"succeeded","outcome":"success","result":{"templateCopy":true}}                                                                                                                                           |

## ENV-no-active-runs

QA leaves no active runs

**PASS** — expected: GET active runs returns empty list; QA pollers were disarmed

Observed assertion result: {"items":[],"nextCursor":null}

| Request                                                             | HTTP | Response excerpt               |
| ------------------------------------------------------------------- | ---- | ------------------------------ |
| H1420: GET /runs?status=queued,running,waiting,paused&amp;limit=500 | 200  | {"items":[],"nextCursor":null} |
