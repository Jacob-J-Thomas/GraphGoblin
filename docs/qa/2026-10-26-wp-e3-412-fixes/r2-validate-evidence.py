"""Read-only validation of retained evidence, including its first-round files."""
from pathlib import Path
import os
import re
import sys

folder = Path(__file__).resolve().parent
issues = []
files = [p for p in folder.iterdir() if p.is_file()]
profile = os.environ["USERPROFILE"]
machine = os.environ["COMPUTERNAME"]
for file in files:
    if file.stat().st_size > 1_000_000:
        issues.append((file.name, "oversize capture"))
    if file.suffix.lower() in (".zip", ".gz", ".7z"):
        issues.append((file.name, "compressed capture"))
    if file.suffix.lower() == ".png":
        continue
    try:
        value = file.read_text(encoding="utf-8-sig")
    except UnicodeError:
        issues.append((file.name, "not UTF-8"))
        continue
    variants = [profile, profile.replace(chr(92), "/"), profile.replace(chr(92), chr(92) * 2)]
    if any(part.lower() in value.lower() for part in variants):
        issues.append((file.name, "profile identity"))
    if machine.lower() in value.lower():
        issues.append((file.name, "machine identity"))
    if re.search(r"S-1-5-21-(?:\d+-){2,}\d+(?![\d-])", value):
        issues.append((file.name, "Windows SID"))
    if file.suffix.lower() == ".log":
        issues.append((file.name, "log must end .log.txt"))
print(f"Read-only check: {len(files)} retained files; UTF-8 text, identity redaction, <=1,000,000 bytes, no compressed capture")
print("PASS" if not issues else issues)
sys.exit(1 if issues else 0)
