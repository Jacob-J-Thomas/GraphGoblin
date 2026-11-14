# Issue #273 held-input fixture correction

**Provenance.** Claude Sonnet 5.5 (`claude-sonnet-5-5`) completed a bounded fixture correction; xhigh effort was requested, but effective effort was not observable. This is implementation evidence, not a review scan or independent QA. The baseline was `bd88ff09069338c0db2d0d64a1e8b291c9eb6602`. Root committed the one-file correction as `bd31d679a8f00693120e212d88efed737962d044`, with that baseline as parent. Root later merged #209 test/evidence-only changes at `700ce251`; no runtime code changed.

The [original handoff](./originalhandoff.md.txt) is preserved byte-for-byte. The [original spec](./specs/original-rename-references.spec.ts.txt), [corrected spec](./specs/corrected-rename-references.spec.ts.txt), and [minimal diff](./specs/original-to-corrected.diff) retain their recorded hashes. Corrected spec SHA-256: `a547686e80d265343134ef03922b50ea69175ff2c34823c794f7184610d56c47`.

## Cause and correction

The original helper selected all Variables text, pressed Backspace, then inserted `[1, `. The JSON field treats empty text as an omitted value, so Backspace could save `variables: {}` before any rename. The original readback showed three PUTs with empty variables; the first preceded the rename. The correction replaces the single-use helper with one select-all/input operation. The corrected first attempt passed. Its two PUTs preserve `variables.key`, and the first PUT is the rename to `check`. The final original-value assertion remains.

The [sanitized request-sequence comparison](./request-sequence-comparison.json) includes only PUT order, status, variable schema, and node IDs. It records the hashes of the root's original readback and the corrected readback. Request paths, headers, tokens, body references, timestamps, raw trace events, screenshots, and store files are omitted.

## Verification and limits

The focused held-input test passed `1/1`; then all five tests in the `rename-references` spec passed. Web typecheck, final Prettier, and final ESLint passed: [focused case](./checks/03-e2e-held-input.log), [whole spec](./checks/04-e2e-rename-all.log), [typecheck](./checks/05-web-typecheck-final.log), [Prettier](./checks/06-format-check-final.log), and [ESLint](./checks/07-lint-final.log).

Playwright-managed Edge used the existing phase-2 built web app. The API and packages loaded TypeScript source through development conditions, backed by an in-memory fake-harness database. This does not establish built-API or file-SQLite behavior. Independent native QA completed at `700ce251bc4c3b7ad29e072d0764ad9a5ca9174e` and is documented in the [separate native report](../2026-11-14-node-reference-independent-native/README.md). That report covers five scenarios across retained attempts; this packet keeps that evidence separate.

Seven paired listings show the same before/after files and match the phase-2 baseline:

| Output                         | Files | Before                                                             | After                                                            | Listing SHA-256                                                    |
| ------------------------------ | ----: | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/dist`                |    28 | [before](./build-listings/apps_web_dist-before.txt)                | [after](./build-listings/apps_web_dist-after.txt)                | `b732610b34d9b02812a876b46d50478e6486e9164e8300d94979fc3cbf54df30` |
| `apps/web/dist-goblin`         |    28 | [before](./build-listings/apps_web_dist-goblin-before.txt)         | [after](./build-listings/apps_web_dist-goblin-after.txt)         | `ed652d122095f20695827ff95e62cb32d31fd6fdb89a4037c22ade4b0b060081` |
| `apps/api/dist`                |   306 | [before](./build-listings/apps_api_dist-before.txt)                | [after](./build-listings/apps_api_dist-after.txt)                | `549f6c30c76d4962c3ac708c3c5eabe94c77690e5d5f1af94374e429b2e9c370` |
| `packages/contracts/dist`      |   117 | [before](./build-listings/packages_contracts_dist-before.txt)      | [after](./build-listings/packages_contracts_dist-after.txt)      | `26ec4ac12a06f6fa9debc4957da5b2e6010a8d9302e72cfa0809842f0cfc6ada` |
| `packages/domain/dist`         |   121 | [before](./build-listings/packages_domain_dist-before.txt)         | [after](./build-listings/packages_domain_dist-after.txt)         | `90aaa6ce5348ce8f2104aaf10d74c129023aa00782fbf29e135101d118950117` |
| `packages/engine/dist`         |   161 | [before](./build-listings/packages_engine_dist-before.txt)         | [after](./build-listings/packages_engine_dist-after.txt)         | `605d569438e6f50ea378296781a833b82d5505e1df68d06e83fd7d247c581266` |
| `packages/infrastructure/dist` |   293 | [before](./build-listings/packages_infrastructure_dist-before.txt) | [after](./build-listings/packages_infrastructure_dist-after.txt) | `5a3a7e6a896b4f363d056da62c457b565b53dc79f26a7aed914b011bb6831075` |

[Identity before](./identity/identity-before.txt) and [after](./identity/identity-after.txt), plus [source hashes before](./identity/source-sha256-before.txt) and [after](./identity/source-sha256-after.txt), show the same baseline HEAD/tree and unchanged unrelated source files. The phase-2 whole-web result of 2,500 passes across 201 files is prior evidence, not rerun for this correction; unit/runtime bytes matched that baseline.

No unit suite, whole-web coverage, full `pnpm check`, new build, or native QA was run here. See the [manifest](./manifest.json) and [artifact hash inventory](./artifact-files.sha256). The nested [`.gitattributes`](./.gitattributes) preserves copied evidence bytes while keeping this README formatted.
