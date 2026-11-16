# Corrected owner Mac engineering acceptance 03

Prepared by a delegated evidence worker. Root verification is pending.

The owner Mac driver's two Node tests passed, and the integrated fixture recorded all nine checkpoints on commit 4341d1f8882f4b69651bfb0b5988345b7f074339 and tree a5f8fa3e13fb297cbcdb386ae445cb8159156617. Build token d75d293f66da44ffb60198a07d8fa2e2 and stage inode 178893353 bind the retained build. Acceptance token c0f8b7c1ff7548fbb19e8e8475ff6c07 completed with SSH exit 0 and driver exit 0, with independent stdout and stderr EOFs. All framed case files were rehashed against the result. [Validation](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/validation.json) · [TAP](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/acceptance-stdout.raw) · [Case manifest](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/manifest.json)

| Evidence | Observed binding |
| --- | --- |
| SSH stdout | 60,385 bytes, SHA-256 56982f0870e4c7df3d4c8d14df473d5a1ae8b07666d5d00b7a40a4d055b1ec7c |
| SSH stderr | Empty, SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Result JSON | SHA-256 3055404b1457e6f7b04086a478e93388002ad038b57d967e2bb9ac3e5fdeeb3e |
| TAP stdout | 1,489 bytes, SHA-256 39ce256d2f94810fa4962e00ede7979dc31a06387c7278426e32341cd189186f |
| Case manifest | 16,490 bytes, SHA-256 333eb17f7a7e70cc3d8b4392a62738dd2e7040218706b755764079b03f7a0e0d |
| Reviewed driver | SHA-256 8dfc56f694770c65a4b41c6a2b390aca42e6c9c172bd5e506fc1608e9b1ecd93 |
| Verified serving identity | PID 46891, birth Mon Nov 16 15:35:08 2026, fingerprint 58e438dd0f7b36d0c761074f442d875fd10d8bca1a153d59d4f40e151351e380 |

The loopback regression passed. Both cold launcher processes, PIDs 46882 and 46883, were given malformed LANG ggcanary17544768eaef/not-a-locale and LC_ALL ggcanary17544768eaef. Each returned exit 0, empty stderr and both EOFs. Their complete stdout records were open-management-running on port 62959. The fixture bound the one gateway to the expected PID, fingerprint, leases and both built shells. The replacement app retained its identity, and the actual held-store timeout wrote the closed waiting-for-store result to its private log. [Cold attempt one](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/011-cold-attempt-one.stdout) · [Cold attempt two](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/012-cold-attempt-two.stdout) · [Held-store log](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/held-store.launcher.log)

The flushed drain record establishes that this acceptance client completed the POST response with status 202. The subsequent checks observed the listener and all four lease/reclaim names released, the original PID birth gone, and the separate helper reporting free. The manifest records verified removal of the disposable bundle, receipt, logs and store, with evidence retained. Post-case build identity and the 437-file pnpm readback still matched. [Drain evidence and cleanup](macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/manifest.json)

| UTC | Drain checkpoint |
| --- | --- |
| 2026-11-16T21:36:40.031Z | post-attempt |
| 2026-11-16T21:36:40.038Z | post-response (202) |
| 2026-11-16T21:36:40.044Z | checking-listener-and-leases |
| 2026-11-16T21:36:40.049Z | listener-and-leases-released |
| 2026-11-16T21:36:40.057Z | original-process-gone |
| 2026-11-16T21:36:40.379Z | store-state-free |

## Mac fixture checkpoints

1. Public install validated its staged bundle and published a receipt-bound alternate app.
2. A foreign listener survived the launcher refusal and no store was initialized.
3. An occupied store without its key refused before spawn and preserved its contents.
4. Concurrent cold attempts with malformed locales completed and a single verified gateway served both built shells after both launchers exited.
5. Warm launch kept the serving PID and private managed logs excluded the request query.
6. A second built API entry contended on the actual physical log reservation before touching its store.
7. The actual managed API refused a missing local key at the store stage, preserving database bytes.
8. Same-path replacement kept the alternate identity and logged the held-store deadline refusal.
9. Supported drain released both leases, the verified process birth and the loopback listener.

This pass binds engineering execution 03 to the corrected candidate. Execution 02 remains a preserved failure under its older harness. Independent Claude native QA and interactive Finder/Dock evidence are tracked separately. [Build 04](macos-product-build-root-result-04.md)
