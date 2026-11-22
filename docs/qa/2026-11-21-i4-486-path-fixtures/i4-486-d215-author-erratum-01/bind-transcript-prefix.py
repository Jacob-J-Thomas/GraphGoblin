from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

folder = Path(__file__).resolve().parent
located = json.loads((folder / "TRANSCRIPT-PROVENANCE.json").read_bytes())
transcript = Path(located["transcriptPath"])
captured_at = datetime.now(timezone.utc).isoformat()
prefix = transcript.read_bytes()
# A live append may leave a partial record after the last complete newline.
prefix = prefix[:prefix.rindex(b"\n") + 1]
lines = prefix.splitlines(keepends=True)
commands = {
    "22-original-junction-cleanup.stdout": (114, 116, "original-junction-readback.ps1", "original junction case"),
    "25-broad-ordinary-cleanup.stdout": (121, 123, "corrected-filesystem.ps1", "ordinary src/fs folder sweep"),
    "27-corrected-junction-cleanup.stdout": (135, 142, "corrected-filesystem-touched.ps1", "corrected junction suite"),
    "35-touched-ordinary-cleanup.stdout": (135, 142, "corrected-filesystem-touched.ps1", "corrected ordinary focused suite"),
    "30-cross-volume-fixture-counts.stdout": (135, 142, "corrected-filesystem-touched.ps1", "corrected cross-volume cases"),
}

def line_binding(number):
    raw = lines[number - 1]
    return {"line": number, "bytesIncludingLineEnding": len(raw), "sha256": sha256(raw).hexdigest()}

results = []
for observation in located["observations"]:
    filename = observation["recoveredOutput"]
    input_line, command_line, script_name, phase = commands[filename]
    response_line = observation["transcriptLine"]
    response = json.loads(lines[response_line - 1])["payload"]
    original_call = json.loads(lines[input_line - 1])["payload"]
    command_record = json.loads(lines[command_line - 1])
    command = command_record["payload"]["item"]
    extracted = (folder / filename).read_bytes()
    assert response["call_id"] == observation["toolCallId"]
    assert any(script_name in argument for argument in command["command"]) and script_name in original_call["input"]
    assert extracted.decode("utf-8") in command["aggregated_output"]
    assert sha256(extracted).hexdigest() == observation["sha256"]
    results.append({
        "stdout": filename,
        "phase": phase,
        "scriptInvoked": script_name,
        "launch": {**line_binding(input_line), "callId": original_call["call_id"]},
        "terminalCommand": {
            **line_binding(command_line),
            "timestamp": command_record["timestamp"],
            "processId": command["process_id"],
            "exitCode": command["exit_code"],
            "workingDirectory": command["cwd"],
            "decodedCommandSha256": sha256(json.dumps(command["command"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
        },
        "toolResponse": {
            **line_binding(response_line),
            "callId": response["call_id"],
            "chunkId": observation["commandOutputChunkId"],
            "chunkExitCode": observation["commandExitCode"],
        },
    })
with (folder / "TRANSCRIPT-SOURCE-BINDING.json").open("x", encoding="utf-8", newline="\n") as file:
    json.dump({
        "transcript": str(transcript),
        "capturedUtc": captured_at,
        "scope": "Exact complete-record prefix during the extraction validation. Later appends are outside it.",
        "prefixBytes": len(prefix),
        "prefixSha256": sha256(prefix).hexdigest(),
        "observations": results,
    }, file, indent=2)
    file.write("\n")
print(f"prefixBytes={len(prefix)} prefixSha256={sha256(prefix).hexdigest()}")

