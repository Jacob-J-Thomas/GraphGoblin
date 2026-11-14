import errno
import json
import os
import stat
import sys

if sys.version_info < (3, 8):
    sys.exit(2)

for _ in range(2):
    line = sys.stdin.buffer.readline()
    if not line:
        break
    response = "ok"
    for index, entry in enumerate(json.loads(line.decode("utf-8", errors="strict"))):
        try:
            path = entry["path"]
            mode = os.lstat(path).st_mode
            expected_kind = stat.S_ISDIR if entry["directory"] else stat.S_ISREG
            if not expected_kind(mode):
                response = "error:{}:{}".format(index, errno.EINVAL)
            elif os.listxattr(path, follow_symlinks=False):
                response = "foreign:{}".format(index)
        except OSError as error:
            response = "error:{}:{}".format(index, error.errno or errno.EIO)
        if response != "ok":
            break
    print(response, flush=True)
