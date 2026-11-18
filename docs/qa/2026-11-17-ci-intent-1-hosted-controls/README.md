# Prepared hosted CI controls for #488 and #496

Seven disposable workflows and one Windows launcher negative suite were prepared and
verified locally. Hosted execution and archive readback remain pending. The workflows
belong on individual QA branches that must never merge.

The #488 controls exercise Gates fan-in, early coverage failure, the coverage step
timeout, a static check failure, and external cancellation. The #496 controls exercise
invalid evidence preparation, evidence when the native step never ran, native failure
output, and rejection of disallowed evidence.

Repository Prettier changed four copies. Full YAML 1.2 object comparisons preserved
every parsed step, condition, and run script in all seven workflows. The negative suite
kept its original bytes. Structural checks tied the candidate CI workflow to SHA-256
`9c3539189770c0efb829550d06ed5cf67829df7db985820b15daf069c801c592` and checked the
documented injections against its Gates and Windows launcher jobs.

[Original preparation record](raw/hosted-overlay-record.md.txt),
[exact overlay files and branch mappings](raw/publication-manifest.json),
[format check receipt](raw/prettier-check.json),
[structural verification](raw/structure-result.txt),
[independent verification receipt](raw/ci-hosted-overlays-root-verification.json).

The [publication manifest](publication-manifest.json) maps the 29 original sealed
records, their [unchanged seal](raw/SHA256SUMS.txt), and the independent receipt to
their archived paths, byte counts, and hashes. It records the archived name of the
source README so its original bytes remain verifiable.
