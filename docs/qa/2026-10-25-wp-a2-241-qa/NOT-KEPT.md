# Not kept

No Playwright output folder, trace, screenshot or copied web build is included in the QA evidence. These generated folders remain at the locations below for the orchestrator to remove; QA did not delete directories. Individual files and SHA-256 values are recorded in [the inventory](evidence/not-kept-files.json).

Folder SHA-256 means the SHA-256 of UTF-8 JSON lines for the sorted {path,size,sha256} records, with a trailing newline; it is not a filesystem directory hash.

| Folder                                                                    | Files |    Bytes | Manifest SHA-256                                                 |
| ------------------------------------------------------------------------- | ----: | -------: | ---------------------------------------------------------------- |
| apps/web/test-results                                                     |   176 | 26520678 | 55685cafbb26bc9fc08e4d2eb653d463496357e700963131cd8b7e389e59cd75 |
| apps/web/playwright-report                                                |    29 |  4926821 | 7bbac52e2ecdfa0e90b05b0c21a9fa10fb17a56d50a2a5c16e8b6304686a1da8 |
| %USERPROFILE%/AppData/Local/Temp/gg-wpa2-qa-seed-mw0tfR                   |    29 | 11978829 | f880f972ae3f6954b45d8f22048c98e3af33f479dd93bec15cc148ec97f6274b |
| %USERPROFILE%/AppData/Local/Temp/gg-wpa2-qa-output-npdAm5/seed-results    |     3 |  1635497 | b81f5fd56a2b4ab9de45dd24c33fc837057570f1c38f4d0f3fea463bb89f334f |
| %USERPROFILE%/AppData/Local/Temp/gg-wpa2-qa-output-npdAm5/seed-report     |    21 |  3526290 | 405223e71e4254f96e3a9d79bb1e041b31147c675c45237ca82b0344f69ad439 |
| %USERPROFILE%/AppData/Local/Temp/gg-wpa2-qa-output-npdAm5/control-results |     1 |       45 | 489b7de7d0c18dbe06008a1ce1225db3f14421d7b25e5f6235d0b8e2c26f6623 |
| %USERPROFILE%/AppData/Local/Temp/gg-wpa2-qa-output-npdAm5/control-report  |     1 |   520895 | e2e623163e01a1248e51839bf1787bfd871002bbf15a929f762743a201b109f1 |

Captures larger than 1,000,000 bytes are included in that inventory, never copied into the report. Coverage output, build dist directories and Turbo caches are also generated locally; only coverage-summary.json is retained as QA evidence. No deletion is authorized or performed by this record.
