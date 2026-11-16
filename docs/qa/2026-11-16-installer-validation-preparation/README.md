# Windows installer baseline preparation

This test-only packet carries the sealed native installer driver and hosted supervisor for #436. The carrier runs the public installer from the actual post-#435 product source on disposable hosted Windows. This is preparation. See the [driver packet](raw/native/README.md.txt), [execution packet](raw/execution/README.md.txt), and [byte-copy inventory](source-copy-map.json).

The Windows job copies only the listed files into its fresh runner temporary control directory. It restores the original README names there and verifies both original manifests. Driver work files, including junctions, stay out of the artifact. The existing Windows launcher regression remains in the job.
