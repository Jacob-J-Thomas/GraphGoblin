# #235 phase 2 drivers (repeatable)

Plain Node ESM scripts. Run them from this directory with Node 22.23.4 on `PATH` after `pnpm build` in the
worktree. Each starts the repository's own disposable e2e backend (`apps/web/e2e/server.ts`: the real API over
an **in-memory** database with the fake harness, on an **ephemeral loopback port**, serving `apps/web/dist`)
and Edge (`channel: 'msedge'`), and stops both in a `finally`. No owner app, store, credentials, ports 4747/4748,
MacSSH or provider calls. Set `GG_E2E_WEB_DIST` to serve another build copy (used for the HEAD-form comparison).

| Script              | What it proves                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `common.mjs`        | Server/browser/context helpers and the schema used for the visual states.                                            |
| `touch-overlap.mjs` | Real touch taps (`page.touchscreen.tap`) at named points; hit box geometry; which taps omit and lose the typed text. |
| `tap-sweep.mjs`     | Dense tap line down the Omit's centre (optionally with a CDP touch radius).                                          |
| `tap-map.mjs`       | 2D grid of real taps over the field's top 14 px and the field above's bottom 12 px, for CSS variants or the build.   |
| `gap-probe.mjs`     | Label-to-control gap per pointer/viewport and the layout shift when Omit appears.                                    |
| `forced-probe.mjs`  | Computed styles of Omit under emulated forced colours (resting border, focus outline).                               |
| `ring-clip.mjs`     | Whether any overflow-clipping ancestor clips the focus ring; padded focus crops; page horizontal scroll.             |
| `screenshots.mjs`   | New run and Wait (plus raw editors) at 1280 and 390, light/dark/forced media, untouched/edited/focus/error states.   |
| `zoom.mjs`          | 4x crop of the focus ring against the input edge.                                                                    |
| `debug-shot.mjs`    | One 390 px coarse form screenshot with the media state printed (used to debug a stale comparison).                   |

`tap-map.mjs` options: `node drivers/tap-map.mjs <label> <variant> <field> <fresh>` with env `GG_ENTRY=newrun|wait`,
`GG_WIDTH`, `GG_STEP` (x step). Variants inject CSS on a coarse pointer so alternatives can be compared before
touching source: `current`, `noafter`, `pad2`, `pad3`, `pad4`, `pad8`.
