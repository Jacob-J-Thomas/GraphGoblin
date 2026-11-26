# D242 static closeout pathname comparison

The first evidence-only invocation after wrapper session 6740 closed with exit 0 stopped at `close.py` line 71 with `RuntimeError: Archive-integrated source receipt differs`. It exited 1 before writing either closeout output. The retained source and index hashes already agreed. The archive integration receipt used a backslash-separated absolute index pathname, while Git returned the same absolute name with forward slashes in the gate snapshot.

The reader used this one-line predicate correction in memory:

```diff
-         archived_after['indexPath'] == after['indexPath'], 'Archive-integrated source receipt differs')
+         Path(archived_after['indexPath']) == Path(after['indexPath']), 'Archive-integrated source receipt differs')
```

Windows path normalization equates the two spellings while the source fields, all before/after snapshots, and raw index bytes remain exactly compared. The original prepared `close.py` remains byte-identical at SHA-256 `489ea72e36fca8a844feb42b332013e547f9bf28f55170cb241779c01faeea64`. The corrected readback also verified the existing contrast and audit summary text. No gate or test reran and no repository source or index was modified.
