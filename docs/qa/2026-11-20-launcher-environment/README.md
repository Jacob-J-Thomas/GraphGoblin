# #437 launcher secret override evidence

Base: `8181f350028e284529c76b51927f32890afcb68a`. Corrected source: `a5cb0603bfa8b3ac2c92eafd1e288c8b4c48c482`.

**Independent corrected-source QA passes 446/446 assertions across 30 cases, with zero failures or inconclusives.** Three core repeats each pass 225/225 with the same final driver. The provider has exited and its true terminal envelope is verified. [evidence.json](evidence.json) retains sanitized per-case observations, code-inspection distinctions, original SHA-256 bindings, and earlier failed outcomes.

The shipped PowerShell installer refuses 19 explicit secret-bearing attempts, including case variants, empty values and companion `Keys`/`keys`/`KEYS`/`psbase` entries, before dependency checks or observed staging. The detector sees staging in every ordinary positive control. Previous files retain bytes, file ID and mtime. Native edited configurations refuse through four non-launching paths without echo or side effects; ordinary and inherited controls pass. This correction QA starts no gateway or Chrome.

The genuine signed-baseline context reproduces the original defect twice: 176 assertions per run, 136 pass, 39 fail and 1 not applicable. The superseded first candidate's limited suite passes 681/681 but omits companion-key shadowing. Final-driver controlled replays expose that gap (429 pass / 16 fail at `8a2a2c1`) and the original baseline behavior (355 pass / 90 fail). Those replays extract historical installer/native source while retaining the corrected checkout and its built apps; they are separate from the genuine signed-baseline runs.

**Earlier ordinary-install compilation failures are retained.** Deep fixtures reached an existing compiler/staging path boundary: the unmodified installer's diagnostic output records compiler exit 0 at a 235-character staged executable path and exit 1 at 236 (CS1567), then CS1619 at 237. Compile/staging code is byte-identical to base. The final driver uses short fixtures and asserts its path budget (longest transient path 223/245). Historical long-path behavior was not independently executed at base; unchanged code plus the current native measurement supports the prior-behavior classification. This remains a separate installation limitation tracked by [#532](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/532), with no added #437 release gate. All failed path-depth attempts and their exact assertion rows remain bound.

The [author report](author/author-report.md), [JSON receipt](author/author-receipt.json) and [supplied subset manifest](author/public-subset-manifest.json) are copied byte-for-byte. They retain the authentic pre-installer PSBase transport failure, old-source transient-staging negative, and failed historical broad native/coverage attempts. The independent first-candidate CLIXML harness negative and evolving capture/cleanup attempts also remain source-bound; later passing rows do not erase them.

Run the [final independent driver](drivers/qa-437-correction.mjs) privately on Windows with Node 22 and a separately built checkout:

```text
node drivers/qa-437-correction.mjs --checkout <built-checkout> --out <short-private-folder> --label <name> --expect-head <sha>
```

Limits include ASCII casing, no Unicode or padded-name coverage, timing-dependent filesystem observation, and no Windows event-log or PowerShell logging inspection. Raw paths, credentials, hostnames and process/environment dumps remain private. The [manifest](evidence-manifest.json) binds every selected file except itself. This packet establishes no formal review, passing broad gate, hosted CI, merge approval or owner acceptance.
