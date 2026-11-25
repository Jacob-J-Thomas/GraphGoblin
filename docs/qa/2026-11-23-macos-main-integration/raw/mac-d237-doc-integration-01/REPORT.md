# D237 documentation integration

Resolved the seven documentation and archive-rule conflicts across eleven hunks in the isolated Mac/current-main checkout. The five-intent register is byte-identical to signed main. The combined attributes and formatter rules retain both archive scopes. The changelog, testing and distribution docs retain the main material and add the Mac content. ADR-0081 remains shared and ADR-0082/0083 retain their existing numbers and filenames. No historical archive was edited.

README adds the optional Finder and Dock launcher with the installer command already present in the guide. The frontend and distribution docs describe the existing authenticated API as the shutdown initiator and the browser's Wait/Force choices as available after an external drain reaches its choice phase. The local branch remains in preparation.

| Working file | SHA-256 after edit |
| --- | --- |
| .gitattributes | fa9475092a8892bdc0d7172b1fe92573e46a4e6251d459bf97bbaed593409528 |
| .prettierignore | e5f060b7918c4725cc8e1642b006ed05d746fae9d4b6138d6ca39a55f5582d72 |
| CHANGELOG.md | 87e5849fdfc08869d8e51b1d8d367735204190cfbda3568a15d10ee5f042f581 |
| README.md | b3cea6244572ac711d1a87817496d5e5b068a7a500e797c7539197ece92b132e |
| docs/09-frontend-and-pwa.md | a627244a4d7e21daf174e091c7052a6835a11fadaf180d2bb807af8ad1ed8b3c |
| docs/10-testing-and-quality.md | e9751c6a81ba0fbff14bcbf73b64a5c263ea16378590c550e9a5826f23cd645c |
| docs/11-security-and-distribution.md | a4287cb67d63ceb1ca34e07d2d61f9b8fd5da72b5095b41cded61af44d417458 |
| docs/decisions/README.md | dded73e22684d07c8d6d576deedd8baedd8d53778edbf55fe28988c890962dc7 |
| docs/delivery/2026-11-17-five-intents-register.md | 23b3926d19af926dedf5b91a4cc243a6615fb457c3240b19456f8dad01eb29d5 |

[Exact worktree diff](resolution.diff) · [File verification](file-verification.json)

Readback checked all nine hashes, the conflict-marker boundary and local installer/guide references. No Git command, staging, commit, build, formatter, test, provider or device-side action ran. Current CI, native, interactive Mac QA and owner acceptance remain pending.
