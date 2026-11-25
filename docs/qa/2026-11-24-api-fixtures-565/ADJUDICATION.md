# Publication adjudication for #565

The independent QA report remains intact. Publication checked the following source and receipt details separately.

- The child negative assertion searches for `seeded jev-api-key`, which matches the logger text in the product’s Jev seed branch. Startup source places this branch before readiness. In-process QA also checked that the resolved Jev configuration was absent. The child check detects this seed log during the test interval.
- The API Vitest configuration installs the cooperative port setup. The API port helper defaults to 5600–5699, and both shutdown suites request 5760–5769. On Windows and macOS the helper separately tries loopback, IPv4 wildcard and IPv6 wildcard binds, tolerates an unavailable IPv6 stack, and closes each successful probe server before reporting availability. An available wildcard probe is a point-in-time check. The test-owned stand-in listens on loopback port 0.
- The build, API and workflow stderr receipts each contain only the corresponding command echoed by pnpm. Format and diff stderr are empty. These findings are based on the original stderr bytes and their recorded hashes.
- The forced run had seven successful Turbo tasks and zero Turbo cache hits. The build may reuse TypeScript incremental state. The built-entry protocol check passed against the emitted `dist/main.js`.
- The Windows CI addition maintains the previously missing native venue for `main.test.ts`. The provider-isolation file has four passing controls in this local Windows packet, and Ubuntu coverage runs it. Broader native and hosted evidence still depends on CI. Preserve #501’s workflow and startup changes when the branches are integrated.

| Reviewed base source                                                                                                                                                               | Lines   | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [apps/api/src/container.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/src/container.ts#L529-L551)                       | 529–551 | `85af3035c6e10812f329083ad252f05e0e4e175b285399a206c0fd41182e3215` |
| [apps/api/vitest.config.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/vitest.config.ts#L12-L19)                         | 12–19   | `da120868ada3276e8d8ba388ab9e21fa4a1d86abadd04942d2c7249659e9ac38` |
| [apps/api/api-ports.global-setup.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/api-ports.global-setup.ts#L1-L80)        | 1–80    | `b02c54b7ac790eb7f351e45e3f1c602b6044306270c2db76727e2c5f3afbf551` |
| [apps/api/api-ports.setup.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/api-ports.setup.ts#L1-L5)                       | 1–5     | `af078ab752778b1dfdbbaef79f204565e072922cabe40e68157c5e35f1e69b6b` |
| [apps/api/src/testing/api-port.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/src/testing/api-port.ts#L53-L84)           | 53–84   | `eb71ae1bde3893034a7f3308b4db29709f7bf8bc471bac4e5e821a2bc865ec54` |
| [apps/api/src/shutdown-startup.test.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/src/shutdown-startup.test.ts#L11-L16) | 11–16   | `df2011bf916badeaa1827e0251875f419a504de067d3fafcb0b812c77783d8ce` |
| [apps/api/src/shutdown-process.test.ts](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/d2df8600c2c8574bec420947de686b936910b245/apps/api/src/shutdown-process.test.ts#L13-L18) | 13–18   | `632c24d4f8089d6896c95c5beb22745e26df707ae6e7938d03e83b5e6069359a` |

[API stderr](qa/api.stderr.log), [build stderr](qa/build.stderr.log) and [workflow stderr](qa/workflow.stderr.log).
