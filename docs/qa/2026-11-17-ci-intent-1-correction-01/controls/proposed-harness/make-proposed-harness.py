"""Derive the author-proposed workflow harness from the exact independent QA bytes (#496 correction 01).

Inserts the corrected job's two new condition strings into the status model's condition table.
Every other byte, including the expected contract table, is unchanged. Not independent QA.
Usage: python -I make-proposed-harness.py <independent workflow-controls.py> <output.py>
"""
import sys

ANCHOR = b'            lambda: outcomes.get("finalize") == "success",\n    }\n'
INSERT = (
    b'            lambda: outcomes.get("finalize") == "success",\n'
    b'        # PROPOSED (author-side, #496 correction 01): the corrected job\'s two new conditions.\n'
    b'        # Setup steps before slot 3 are modeled as successful, as in the original harness.\n'
    b'        "${{ !cancelled() && steps.node.outcome == \'success\' }}":\n'
    b'            lambda: not cancelled,\n'
    b'        "${{ always() && steps.evidence.outcome == \'success\' }}":\n'
    b'            lambda: outcomes.get("evidence") == "success",\n'
    b'    }\n'
)
source, output = sys.argv[1:]
data = open(source, "rb").read()
if data.count(ANCHOR) != 1:
    raise SystemExit("anchor not unique")
open(output, "wb").write(data.replace(ANCHOR, INSERT))
print("wrote", output)
