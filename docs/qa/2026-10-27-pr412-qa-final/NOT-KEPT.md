# Captures not retained in the record

Disposable fixtures and inspection copies stay under `%TEMP%/gg-qa-412f-*` for the orchestrator. They are working data, not a saved database evidence claim. Server logs are copied separately after full-text redaction. No compressed traces were captured.

| Capture/input omitted                                                        |     Bytes | SHA-256                                                          |
| ---------------------------------------------------------------------------- | --------: | ---------------------------------------------------------------- |
| gg-qa-412f-main-qY6ffO/source.tar (immutable main build input, left in temp) | 513904640 | 916bdc75b9063c280b2a2a068b769dcdd38a7a7d8bfb71841598e1abba4deb74 |
