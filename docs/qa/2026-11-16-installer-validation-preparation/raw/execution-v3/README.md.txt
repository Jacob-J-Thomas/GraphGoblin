# #436 hosted execution preparation, driver seal correction

Preparation only. Run 894 stopped in preflight because execution-v2 still pinned the first driver's seal while the reviewed corrected carrier admitted the Unicode driver. The binder rejected this at its exact-seal check before validating either packet or launching the driver or ETW. [Retained preflight failure](../launcher/436-hosted-baseline-corrected/README.md)

This packet pins native-v2's exact seal `ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a` in the binder, carrier example and admission example. Each of these files changes only that literal. The other executable and inventory payloads retain v2 bytes. The binder still requires the exact pinned driver and complete packet manifests before running source, output and tool inventory checks. [Exact three-reference delta and coherence readback](../launcher/436-execution-v3-preparation-delta/README.md)

Use this packet only for a fresh admitted matrix with the reviewed Unicode fixture driver. The root carrier must match the same driver seal, this packet's new seal, exact Git object and carrier path list, and the reviewed runtime and build receipts. The existing supervisor bounds, archive paths and version-4 observer behavior continue to apply. [Native-v2 preparation](../launcher-436-native-v2-preparation/README.md) · [Observer-v2 scope and replay](../launcher-436-execution-v2-preparation/README.md)

Local checks exercised file hashing, a static cross-packet readback, Node's syntax checker and PowerShell syntax parsing. The binder, hosted workflow, compiler, driver, installer, COM and ETW were never invoked by this preparation.
