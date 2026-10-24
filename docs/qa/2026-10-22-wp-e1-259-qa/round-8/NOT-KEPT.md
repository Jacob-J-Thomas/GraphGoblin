# Captures not kept in the worktree

These captures exceed 1,000,000 bytes. They remain only in disposable temporary storage. The comparison results, exact sizes, SHA-256 and reproducible scripts are retained. The two SSE captures reproduce the original failed response byte for byte; their hashes agree with the failure records. No directory or old capture was deleted.

| Name                              |   Bytes | SHA-256                                                          |
| --------------------------------- | ------: | ---------------------------------------------------------------- |
| variables-download-1440.json.txt  | 7827782 | b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3 |
| variables-api-1440.json.txt       | 7827782 | b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3 |
| variables-download-390.json.txt   | 7827782 | b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3 |
| variables-api-390.json.txt        | 7827782 | b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3 |
| invalid-large-stream-1440.sse.txt | 6447766 | 353bd437d292af3d307a43ef1341c58f0354f80e63436a8af53596ae2914f2ec |
| invalid-large-stream-390.sse.txt  | 6447765 | 249ac577bf2450de0ef83161368cdae079cc437c5b1b5a41428f038456efdc10 |
