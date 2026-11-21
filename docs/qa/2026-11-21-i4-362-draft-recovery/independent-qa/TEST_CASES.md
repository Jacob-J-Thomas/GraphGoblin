# Executed existing cases

Each suite ran once at the exact candidate. All cases passed.

| Suite | Existing case | Status | Milliseconds |
| --- | --- | --- | --- |
| engine | draft runs pin a snapshot of the draft keeps the snapshot through an edit while waiting; a new draft run sees the edit | passed | 160.4919 |
| engine | draft runs pin a snapshot of the draft keeps the snapshot when the draft is edited while a node is running | passed | 370.5763 |
| engine | draft runs pin a snapshot of the draft continues on the snapshot after a restart, and a replay fork reuses the pin | passed | 108.5391 |
| engine | draft runs pin a snapshot of the draft never starts a snapshot directly | passed | 33.1765999999998 |
| engine | published runs pin their version keeps the version through a newer publish while waiting; a new run takes the newer one | passed | 136.624699999999 |
| engine | inherited model defaults are pinned at start ignores Settings and process default changes for a waiting run, across a restart | passed | 152.9974 |
| engine | children keep their own pins runs the selection pinned at parent start, on every visit, with the parent defaults | passed | 368.3679 |
| engine | triggered starts pin like manual ones pins a webhook admission at claim time and a poll item at admission | passed | 34.3471 |
| engine | classifier bindings are pinned at start calls the binding pinned at start after a catalog edit while waiting and a restart | passed | 78.5237999999999 |
| engine | classifier bindings are pinned at start keeps availability live: a disabled classifier fails explicitly, and nothing is substituted | passed | 57.1935999999996 |
| engine | classifier bindings are pinned at start never looks up a classifier that was missing when the run started | passed | 46.8338999999996 |
| engine | classifier bindings are pinned at start binds and calls a classifier whose catalog id is an Object property name | passed | 75.4085999999998 |
| engine | classifier bindings are pinned at start treats an unbound Object property name as missing, not as an inherited binding | passed | 46.5007000000005 |
| engine | classifier bindings are pinned at start gives a child its parent binding for a shared classifier | passed | 107.3169 |
| engine | pin labels name the source and number | passed | 0.301800000000185 |
| api | validates manual inputs against the selected schema across loops, versions and restart | passed | 2389.5346 |
| api | runs pin their definition across edits, Settings changes and a restart keeps published and draft runs on their start definition and defaults | passed | 1315.4807 |
| api | classifier bindings are pinned at start calls the provider model a waiting run pinned, after a catalog edit and a restart | passed | 840.109900000001 |
| api | classifier bindings are pinned at start starts and runs a classifier whose catalog id is an Object property name | passed | 353.9606 |
