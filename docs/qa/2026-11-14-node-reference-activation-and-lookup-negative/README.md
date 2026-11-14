# Independent negative evidence: rename activation and nested lookup

This packet combines two separately retained negative evidence sets from the node-reference-273 activation supplement. The underlying evidence is copied byte-for-byte. The original activation README is retained as `README.md.txt`; this wrapper summarizes the two experiments without replacing their reports or observations.

## Separate source manifests

- [Activation retain manifest](retain-manifest.json): 23 payload files, 698,129 bytes, SHA-256 `bd7ce346c076416a282b898e7b50ef05a0e2fe75c2db228b3557e66f81072a16`.
- [Nested lookup retain manifest](lookup-retain-manifest.json): 10 payload files, 96,125 bytes, SHA-256 `9c5bc9abfa63204ebd7a57f5859c3bddfa4bb01bacc777fd515e1f1b3077b0af`.

The manifests remain separate and exact. [The outer copy manifest](retained-files-manifest.json) inventories their 33 payloads plus the two manifest copies: 35 files, 801,512 bytes in total.

## Rename pointer activation reproduction

[Original activation report](README.md.txt) records a native Windows Edge reproduction at clean head `5a4fb439c63755eeb2b5bef945319772623a9905`, tree `caf777a63de7d9938b03dfa81b9ee60e9a1bf3e5`, using a retained runtime built from `164c01a2e3a52bf0ef69a409e1a428b45817b1b8`. When a pending self-reference rename repaired the Node ID and remounted the form, the first trusted pointer activation on Add operations or Remove operations 2 was lost. The same second click activated once; undo restored the original state.

Both the original fixture attempt and the corrected canonical-Add run remain under `runs/`. The first attempt wrongly assumed a default blank-path Set would remain device-only; the gateway actually saved it. The corrected fixture includes that real synced PUT in its control. This correction changes the fixture setup, not the observed negative result. The run's own cleanup and source-binding records are retained. The bounded native scope was Windows Edge and a compiled gateway with disposable file SQLite; it was not a broad native matrix.

## Nested `$lookup` negative reproduction

[Historical lookup report](lookup/lookup-old-report.md.txt) preserves the old retained-runtime negative. A public immutable domain rename repaired the structural start-node edge but left the computed `$lookup(outputs, outputs.start.value).value` key stale. The new version published, while the old pinned graph still resolved the original payload and the new pinned graph returned JSON null. In a separate case, a nested missing visit inside `$string(counters.nodeVisits.missing)` was treated as publishable: actual Publish returned HTTP 200 and switched current from v1 to v2. Immutable v1 and its pin remained exact; pinning v1 still produced the original release. Direct missing-reference controls behaved as expected, and explicit optional `exists` inside the key remained non-blocking. The outer unknown-node uncertainty warning remained appropriate; this evidence does not claim a public rename endpoint.

These are retained defect reproductions, not proof of correction. The later final audit records CHANGES REQUIRED for its A1/A2 findings. They do not establish owner acceptance, complete provider coverage, or current-head integration. The observed artifact bindings and gateway cleanup records are included in the two source manifests.

## Integrity

`SHA256SUMS.txt` records the retained files, this wrapper, and the link-check record. `.gitattributes` disables text conversion to preserve the copied raw bytes. `link-checks.json` records local README links resolved in this directory. Only manifest-listed evidence and the two source manifests were copied; no gateway store or credential material is included.
