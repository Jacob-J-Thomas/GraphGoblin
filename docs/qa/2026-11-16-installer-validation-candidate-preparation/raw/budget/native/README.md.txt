# #436 candidate native installer driver

Preparation only. This driver carries the same native-v2 32-case matrix and exact Unicode Shell Link tooling. Its only code change is the whole-run scheduling limit of 450 seconds. The existing 25-second per-child maximum, minimum remaining schedule time, 5-second child pipe-close bound, $qaProcessLimit of 50 and expected 49 direct child receipts remain in place.

The baseline hosted matrix ran both the driver and the public installer under x64 STA PowerShell 7. This candidate driver uses the same public invoker and runtime. Separate Windows PowerShell 5.1 product regression coverage remains a different evidence source. The synthetic Shell Link fixture, port/store readbacks and exact file snapshots still exercise the same installed behavior. [Native-v2 scope](../../launcher-436-native-v2-preparation/README.md) · [Baseline proof and timing](../../launcher/436-hosted-baseline-retry/README.md)

Only use this packet with the matching reviewed candidate execution packet and a separate root admission. Syntax only was checked here. No candidate process, compiler, installer, COM, ETW or hosted job ran.
