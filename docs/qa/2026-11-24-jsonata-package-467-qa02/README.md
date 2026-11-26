# #467 fresh independent QA02 and integrated image proof

Actual fresh Claude QA02 returned **PASS** for PR 571 head `d312119ccbb8be2690fe719d460f31ee0a804221`, tree `806813008973429e85c18f343f2cbffaef9d91f9`, target `631d16e39b8e9932f4763390a4166fa67eea8df3`. It ran identity, hosted-image and compiled-host checks once each, in order, with exit 0. The original report and receipts are preserved unchanged. This is independent QA and existing CI evidence, not a new formal scan or owner acceptance. [Actual report](qa-02/QA-REPORT.claude.md.txt), [actual model receipt](qa-02/CLAUDE-EXIT.json).

## Identity and actual QA

| Binding                 | Value                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Actual model            | `claude-opus-5-5`, xhigh runner; API-key source none; observed overage false                                                       |
| Head/tree               | `d312119ccbb8be2690fe719d460f31ee0a804221` / `806813008973429e85c18f343f2cbffaef9d91f9`                                            |
| Target                  | `631d16e39b8e9932f4763390a4166fa67eea8df3`                                                                                         |
| Local merge parents     | prior integration `7064dab41e11f38229a31a8626f930a8f139b915`, then target 631d                                                     |
| Hosted checkout/parents | `ad2bab47f4d9d70a63737bb10e8b6083cb905cff`; `[631d16e39b8e9932f4763390a4166fa67eea8df3, d312119ccbb8be2690fe719d460f31ee0a804221]` |
| Source patch            | `98df17ae1ff9b17ae21055c87707520d946fe2589b29fc74add21bb27f90074a`                                                                 |
| Index                   | `d60a33410d8cb7bbadf3f159f29ba1296ecae025fd5385a1fc9791edfe6021b5`                                                                 |

The actual session's report hash is `016f53d1cd4db81d65ec3624e3e7f43d8e0a27c2c99606719937d567f65e2e8d`. All three actual check-receipt hashes and their unchanged before/after source/index records were rechecked during curation. The identity check verified four source hashes, original/prior/current dependency inputs, current public export and old-packet committed/index receipts. [Identity result](qa-02/IDENTITY-RESULT.json), [hosted result](qa-02/HOSTED-RESULT.json), [host result](qa-02/HOST-RESULT.json), [source binding](qa-02/SOURCE-BINDINGS.json), [candidate manifest](qa-02/CANDIDATE-MANIFEST.json).

Original publication head `87dcfec6883568494f75d8279347110e5bf62e01` targeted d2df; prior integration head 7064dab targeted 154e. They are historical fields, not substituted parents/targets for the current result. The two older image logs are retained under history only and do not establish the current shipped image.

The existing 12 raw members of docs/qa/2026-11-24-jsonata-package-467 remain unchanged. Curation rechecked original/prior/current committed blobs and current index blobs without checking out, restaging or editing that sparse-omitted packet. This does not claim physical files were newly materialized. [Old 12 verification](binding/OLD-PACKET-12-VERIFIED.json).

## Actual distributed image

[Run 45542221565](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/45542221565), attempt 1, ran the actual Template image job [138963218351](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/45542221565/job/138963218351). Checkout, image build, installed-template load and installed-JSONata evaluation steps succeeded. The exact synthetic checkout has the candidate tree and ordered target/head parents above.

The actual independent-QA image fetch and the separately retained hosted-ci03 capture have identical raw log bytes: **45,990 bytes**, SHA256 `bbe322326e76e2517562354c6792751af8d7f6a4711e016f432ff7380897977e`. [Raw image log](hosted-ci-03/template-image.raw.log.txt), [hosted verification](hosted-ci-03/VERIFICATION.json), [raw metadata hashes](hosted-ci-03/CAPTURE.json).

The log binds `docker build --tag graphgoblin-template-check .` and the exact container run with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, using the public domain entry from `/app/apps/api`. It retains exported image digest lines, exact echoed JavaScript and the finite output. The probe's SHA256 is `062bb6e33b4bf80dcf0c2a0c4519a89497d128abbd4b58907a6daad47eadd06d`. [Exact probe](probe/WORKFLOW-PROBE.mjs.txt), [workflow source](public-source/.github/workflows/ci.yml.txt), [Dockerfile](public-source/Dockerfile.txt), [domain export](public-source/packages/domain/package.json.txt).

The successful probe asserts ordinary value 3, a literal containing both an array of 250 siblings and an object of 250 entries, distinct maxDepth 0 and negative-time refusals with ExpressionError identity and exact messages, then fresh value 1 on the same cached expression source. Its finite JSON is ordinary 3/wideSiblings 250/depth reason+message/time reason+message/fresh 1. The actual QA report explicitly says its summarized tool output did not show both structures or the error class and that the agent did not read the probe text. Credit for those assertions rests on the included public probe bytes, matched echoed hash and successful actual container step; the report is not rewritten as a different inspection.

The licenses documentation pins JSONata 2.2.2 and the pnpm patch/lockfile obligations. The existing source/patch is supplied for audit, without adding a dependency or claiming wider expression coverage. [Patch](public-source/patches/jsonata@2.2.2.patch.txt), [source](public-source/packages/domain/src/expression.ts.txt), [source tests](public-source/packages/domain/src/expression.test.ts.txt), [licenses](public-source/docs/research/licenses.md.txt).

## Current-target hosted CI, separately captured

The recorded head d312/target 631d run 45542221565 concluded **success**, with all six jobs successful: Template image 138963218351, Repository checks 138963218641, Browser 138963218717, Windows launcher 138963218758, Coverage 138963218811 and Gates 138969938874. The five checkout-bearing jobs logged the same ad2bab47 checkout. Run/attempt/job/commit/PR/main metadata are retained and their original capture hashes were recomputed. The image log above is the full current raw image evidence; unrelated job logs/artifact ZIPs remain in the original hosted-ci03 capture and are not recounted as additional independent QA here.

The QA report kept full CI outside its own verdict; this separate hosted capture supplies the all-job conclusion for the recorded source and target. It does not certify a future packet/integration head. [Run metadata](hosted-ci-03/run.raw.json), [attempt](hosted-ci-03/attempt-1.raw.json), [jobs](hosted-ci-03/jobs-attempt-1.raw.json), [synthetic commit](hosted-ci-03/synthetic-checkout.raw.json), [capture handoff](hosted-ci-03/HANDOFF.md.txt).

## Evidence limits and remaining gates

- **Timestamp behavior is source-unit evidence only.** The included source test exercises `$millis()` across interleaved evaluations. It does not call `$now()`, and this finite image probe exercises neither timestamp function.
- **Windows compiled dist is corroboration only.** Node v22.23.4 from apps/api resolved existing packages/domain/dist/index.js, SHA256 `a391fc41bea5ea5f280cc5eae13b245baec66a242c1f5c231f786f46a4566d59`, and returned the same finite result. It was not rebuilt during QA and does not prove that local dist came from this head. Actual shipped-image evidence is the separate container run.
- **Operator preparation is separate.** The preserved first docs-control byte assertion encountered CRLF materialization in an owned scratch copy. Its qualified LF comparison and later source checks are preparation, not actual Claude QA. Root's integration proof records preserved original CHANGELOG insertion/docs 10 patch and unchanged other candidate paths. [Original integration proof](binding/INTEGRATION-569.json), [source diff](binding/INTEGRATED-SOURCE.patch), [first preparation assertion](preparation/OPERATOR-DOC-CONTROL-FIRST-ATTEMPT.json), [preparation result](preparation/OPERATOR-PREPARATION.json).
- **No owner acceptance is inferred.** No owner store/service or local Docker Desktop was used for these bounded checks. This is not deployment, all-host cleanup, personal device testing or completion of owner QA.
- **Publication/final gate remains pending.** This packet was prepared externally from completed QA02 before repository publication. The packet publication records evidence; it does not rerun or reattribute the original source QA. Required exact publication-head/current-target CI must follow #574 merging so it includes the known Chat test correction, before the reserved fresh Astra final scan02. No push or integration is performed by this packet commit. A PR comment URL alone does not replace repository evidence. Historical curation ran no tests, native execution, models or extra formal scan; local publication adds only this packet.

MANIFEST.json binds the selected raw members. Reports/logs and public code are stored as `.md.txt`, `.log.txt` and code-extension`.txt` with exact original bytes; packet attributes prevent newline conversion. Private provider event streams/prompts, credentials/keys and raw databases are excluded. All selected public source exports come from the exact committed head; no product file was changed to prepare this packet.
