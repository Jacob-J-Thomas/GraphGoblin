# Independent canvas QA

The reports capture behavior at stacked head `64a955887962f72287e532824be1b8cb32c5f055` before the post-pan action correction.
The retained test tier is native desktop Edge with actual compiled API and file SQLite.

- [Twelve bounded groups and frozen identity](native-stacked-report.md.txt)
- [Confirmed post-pan Remove activation blocker](pan-diagnostic-report.md.txt)
- [Run index with first fixture attempts and exact driver bindings](run-index.json)
- [Final process cleanup](pan-diagnostic-cleanup-final.json)

The raw Markdown reports use the `.md.txt` extension to keep exact observed evidence bytes.
Each run retains result, process closure and full synthetic graph readback. Selected gateway records retain served asset identities.
The run index maps every initial or corrected fixture to the exact deduplicated driver. The root runner uses the final full driver unless pointed at a named historical variant.
To replay the targeted diagnostic, use its dedicated runner against the frozen head, actual target and compiled manifest.

The failed action remains a blocker under the observed post-pan timing. The earlier zoom control, fixture failure in the diagnostic control and standalone positive evidence have distinct records.
No browser cache, database, generated credential, environment dump or provider transaction is included.
