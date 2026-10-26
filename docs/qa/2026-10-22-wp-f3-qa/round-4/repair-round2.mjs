// Record-only edit from the committed historical report; no results are regenerated.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const target = 'docs/qa/2026-10-22-wp-f3-qa/round-2/README.md';
let text = execFileSync('git', ['show', '9f654e7f:' + target], { cwd: repo, encoding: 'utf8' });
text = text.replaceAll('â€“', '–').replaceAll('â€”', '—');
text = text.replace(
  '## 1. Verdict and revision',
  `> Historical round-2 narrative, repaired in round 4. The original round-2 raw
> scripts, JSON and logs were lost during curation; none is presented as retained
> evidence here. No owned round-1/2 TEMP directory remains from which to recover
> them. Names shared with round 3 previously made missing round-2 files appear to
> resolve in a basename-only checker. Those references are removed too.
>
> [Round-3 replays](../round-3/README.md) are fresh observations on a later head,
> not the original round-2 evidence. [Round-4 repair](../round-4/README.md) records
> the citation audit. The verdict below is the original verdict. The subsequent
> delivery disposition places R2-01/R2-02 outside #243 as pre-existing inspector
> gaps; this repair does not repeat their tests or alter the historical findings.

## 1. Verdict and revision`,
);
text = text.replace(
  'Round-1 evidence remains in the parent directory; all round-2 work is here.',
  'The round-1 report remains in the parent directory; the original round-2 raw\nartifacts are not retained. This file preserves the observed outcomes.',
);
text = text.replace(
  /Reproduce with `node[^\n]+interactive-detail\.mjs`\./,
  'The original round-2 reproduction used a QA-only replay that was not retained.',
);
text = text.replace('It creates an isolated built API', 'It created an isolated built API');
text = text.replace(
  /Evidence: \[interactive-detail-results\.json\]\(interactive-detail-results\.json\) records\nthe controls, compressed visible text, latest transcript presence and exact lengths\./,
  'The original observation recorded the controls, compressed visible text, latest\ntranscript presence and exact lengths. Its raw JSON was not retained.',
);
text = text.replace(
  /result remains complete\. Evidence: `interactive-detail-results\.json`, with the\nearlier independent observation preserved in `interactive-primary-results\.json`\./,
  'result remained complete in both completed round-2 observations. Their original\nraw records were not retained.',
);
// Preserve each criterion, measurement and expected/actual result; retire only its
// misleading evidence-file cell (all original round-2 artifacts are absent).
const sectionStart = text.indexOf('## 3. Per-check'),
  sectionEnd = text.indexOf('## 4. Coverage');
let table = text
  .slice(sectionStart, sectionEnd)
  .split('\n')
  .map((line) => {
    if (!line.startsWith('|') || line.includes('| Check ') || /^\|[- |]+\|$/.test(line))
      return line;
    const columns = line.split('|');
    columns[columns.length - 2] =
      ' Historical round-2 observation; original raw artifact not retained. ';
    return columns.join('|');
  })
  .join('\n');
table = table.replace(
  'original failed QA payload is retained separately.',
  'the initial QA payload was corrected; its original diagnostic was not retained.',
);
table = table.replace(
  'earlier valid observation about 520 ms retained.',
  'the earlier observation was about 520 ms; its raw record was not retained.',
);
text = text.slice(0, sectionStart) + table + text.slice(sectionEnd);
text = text.replace(
  'Fresh public `parseCLI` evidence shows',
  'The round-2 public `parseCLI` observation showed',
);
text = text.replace(
  /Final single-worker results and\nfresh denominators are in `single-worker-infrastructure\.log`, `single-worker-api\.log`\nand `gate-summary\.txt`\./,
  'The original single-worker logs and gate summary were not retained; the results\nand denominators recorded here are historical observations.',
);
text = text.replace(
  'Both original exact-command results remain preserved.',
  'The original exact-command raw outputs were not retained.',
);
text = text.replace(
  /Every initial failed infrastructure case was also rerun \*\*alone\*\*, one worker, in\n`triage-native\.ps1`; all eight reproduced\. See `triage-summary\.txt` and named logs\./,
  'Every initial failed infrastructure case was also rerun **alone**, one worker;\nall eight reproduced. The original triage driver, summary and logs were not retained.',
);
text = text.replace(
  'These are preserved failed host qualifications',
  'These remain historically reported failed host qualifications',
);
text = text.replace(
  /The overall run failed later at \*\*Dependency audit\*\*\. `ci-run\.json` is the API job\/step\nrecord; detailed logs could not be fetched \(HTTP 403, admin rights required\), recorded\nin `ci-log-extract\.log`\./,
  'The overall run failed later at **Dependency audit**. The original API job/step\nmetadata and fetch diagnostic were not retained. Detailed logs could not be fetched\n(HTTP 403, admin rights required).',
);
const five = text.indexOf('## 5. Evidence and QA fixture corrections'),
  six = text.indexOf('## 6. Documentation');
text =
  text.slice(0, five) +
  `## 5. Evidence and QA fixture corrections

The original small text/JSON/scripts were lost during curation. This narrative is
the retained historical record; it is not a substitute for those raw observations.
No screenshots, traces, credentials or owner data were originally persisted.

The original replays were round-1 copies with relative imports/output moved into
this directory. QA-only corrections were the input body key; an early submission
observer watching only the result even when the assistant record had already
announced submission; the timeline progress label using the node ID; and PowerShell
Continue to collect a harmless native stderr color warning. The original failed
setup diagnostics and runner-abort record were not retained.

The second completed interactive run was a targeted diagnosis: select the latest
terminal thread too, and measure initial/progress/full-JSON widths separately.
Both completed observations reported the same inspector gaps. No broad suite was
retried to erase a failure; the additional coverage collection corrected the worker
argument defect and supplied missing denominators. The fresh later replay kit is
linked at the top and is explicitly separate from this round's lost raw evidence.

` +
  text.slice(six);
const seven = text.indexOf('## 7. Cleanup'),
  inventory = text.indexOf('Final inventory:');
text =
  text.slice(0, seven) +
  `## 7. Cleanup

Historical round-2 cleanup observation: real base/candidate migration processes
were stopped and confirmed exited before their stores/copy were removed. Native
recipe/API stores removed themselves after their processes exited; Edge and
interactive server/browser processes were closed before store removal.

The Claude replay's five feature checks passed, but its command exited **1** on
Windows EBUSY removing a DB sidecar. After that Node invocation was confirmed
exited, the remaining dedicated store was handled separately. The original cleanup
logs, manifests and listener/Git boundary record were not retained.

Native infrastructure fixtures with unconfirmed child termination were listed for
handoff. No unknown process was killed or uncertain fixture removed. The following
inventory is the original round-2 observation, not a new round-4 process audit.

` +
  text.slice(inventory);
// No original evidence filename should silently resolve to a later-round basename.
text = text.replace(
  /`[A-Za-z0-9_./\\-]+\.(?:log|json|mjs|ps1|txt)`/g,
  'the unretained round-2 raw record',
);
text = text.replace(
  'empty tracked/index diffs are recorded at closing.',
  'empty tracked/index diffs were observed at closing; that raw record was not retained.',
);
await writeFile(join(repo, target), text);
