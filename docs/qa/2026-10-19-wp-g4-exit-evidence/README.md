# QA recipe: exit evidence after the decision-gate redesign (#129)

These steps are the QA recipe for #129, which absorbs report #258; the independent QA agents and anyone else checking the running product follow them. They run on a separate, disposable instance. Do not use the instance on ports 4747/4748 or its store.

The capability inventory and the before/after quotes are in [2026-10-18-exit-evidence-inventory.md](../2026-10-18-exit-evidence-inventory.md). This folder holds four loops that need no model turns, and one helper script:

| File                   | Loop                                  | What it exercises                                                                                                                                               |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-loop.json`       | QA 129 gate repeat                    | An expression gate that always repeats, with maximum passes 3, Limit reached and an Exhausted exit                                                              |
| `suppressed-loop.json` | QA 129 returns none with destinations | An exit with Returns None and two destinations (caller, log)                                                                                                    |
| `quiet-loop.json`      | QA 129 quiet exit                     | An expression decision that always takes its Ignore route to a quiet exit (Returns None, no destinations); its Keep route leads to an exit that returns a value |
| `history-loop.json`    | QA 129 omitted null                   | An exit with Returns `null` and a caller destination, whose finished run section 6 amends to look like an older build's history with the null result omitted    |
| `omit-null-result.mjs` | (helper)                              | Removes `result` from one run's stored `run.finished` event and clears its run row's result, with the instance stopped (section 6)                              |

## 1. Build and start an isolated instance

Run these from the repository root in PowerShell, with the branch checked out. The data directory is disposable, and port 5641 avoids the owner instance.

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
$env:GG_PORT = '5641'
$env:GG_HOST = '127.0.0.1'
$env:GG_DATA_DIR = "$env:TEMP\gg-qa-129"
node apps/api/dist/main.js
```

Leave this window running.

## 2. Import and publish the four loops

In a second PowerShell window at the repository root:

```powershell
$qa = 'docs\qa\2026-10-19-wp-g4-exit-evidence'
foreach ($file in 'gate-loop.json', 'suppressed-loop.json', 'quiet-loop.json', 'history-loop.json') {
  $created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5641/loops' `
    -ContentType 'application/json' -InFile (Join-Path $qa $file)
  # Windows PowerShell sends a form content type on a bodiless POST, which the API refuses (415).
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5641/loops/$($created.loop.id)/publish" `
    -ContentType 'application/json' -Body '{}' | Out-Null
  "$file -> $($created.loop.id)"
}
```

Open `http://127.0.0.1:5641/app`. For each loop, open it on **Loops** to check the editor. Then start a run from **Runs → New run** and open the run.

## 3. QA 129 gate repeat

Open the **Gate** node in the editor:

- The **Routes** help reads "At least 2 items. Two to sixty-four routes with unique ids and unique labels; the expression returns one id."
- Each route **Id** says "Stable route id and output port; changing display order does not change the route."
- Each route **Label** says "Unique readable route label, shown on the canvas and in Connections."
- Changing the second label to `Again` shows "route labels must be unique" under that field. Undo the change.

Run it:

- The status is **exhausted** and **Result** shows `3`.
- **Exit evaluation** shows "Exited: exhausted" and "Last gate decision: gate chose again on pass 3 of 3; maximum passes stopped the repeat, so it took Limit reached."
- In **Timeline**, select the last `decision.made`. Evaluation details show:
  - **Route ID** `again`
  - **Selected port** `limit-reached`
  - **Label** "Again"
  - previous/current passes 3 and 3
  - **Limit stopping repeat** "Maximum passes"

Optional: switch the Gate to a classifier with a Choice answer. The **Options** list shows "Two to sixty-four uniquely labelled options, each with a unique stable id (its output port) and a nonblank criterion." Each option shows its id, label and criterion help. No classifier needs to be configured for this. Running a Choice gate needs an enabled Choice-capable classifier, which may be a live provider call. The browser spec `apps/web/e2e/classifiers.spec.ts` covers that run against a fake classifier, including the **Criterion** row.

## 4. QA 129 returns none with destinations

Open the **Done** exit:

- **Returns** shows **None** and "No returned value. The run finishes without a result, and destinations receive nothing."
- The **Destinations** help reads "Returns is None, so these 2 destinations receive nothing. Choose a JSONata expression to deliver a value, or remove destinations for a quiet exit."

Run it:

- The status is **succeeded** and there is no **Result** card.
- **Exit evaluation** shows "Exited: success" and "No value was returned: Returns is None, so no destination received anything (caller, log from the exit). This is the exit’s configuration, not a failure."
- Select `exit.evaluated` in **Timeline**. Evaluation details give the same reason after "Exit outcome: success. This exit is terminal."

## 5. QA 129 quiet exit

Open the **Quiet** exit:

- The **Destinations** help reads "Quiet exit: nothing is returned or delivered. The run still finishes with its outcome."
- The **Kept** exit, which returns `"kept"`, shows the ordinary destinations help.
- Add a new Exit from the palette. It shows its default caller destination with "Returns is None, so this destination receives nothing. …".

Run it:

- The status is **succeeded** with no **Result** card.
- **Exit evaluation** shows "Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure."

## 6. QA 129 history that omitted a null result

A format-4 run recorded by an older build omitted a `null` result from `run.finished` (CHANGELOG). The inspector must not turn that gap into a Returns None explanation when the pinned exit has an expression (independent acceptance audit, 2026-10-21).

Start a run of the **QA 129 omitted null** loop (its **Done** exit has Returns `null` and a caller destination) and open it:

- The status is **succeeded**; the **Result** card shows `null`; there is no exit-returns sentence.
- Note the run's ID (the address bar, or the **Runs** list).

Stop the instance (Ctrl+C in its window) and amend only that run in the disposable store with the script in this folder; it removes `result` from the stored `run.finished` event and clears the run row's result, as an older build's history looks:

```powershell
node docs/qa/2026-10-19-wp-g4-exit-evidence/omit-null-result.mjs "$env:GG_DATA_DIR\graphgoblin.db" "<run id>"
```

It prints `amended run <id>: 1 run.finished event(s), 1 run row(s)`. Start the instance again (section 1's last command) and open that run:

- There is no **Result** card.
- **Exit evaluation** shows "No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record." It does not say "Returns is None".
- Select `exit.evaluated` in **Timeline**. Evaluation details give the same sentence after "Exit outcome: success. This exit is terminal."
- The earlier runs of sections 4 and 5 still show their Returns None and quiet-exit explanations.

## 7. Stop and clean up

Stop the instance with Ctrl+C in its window, then delete the disposable data:

```powershell
Remove-Item -Recurse -Force "$env:TEMP\gg-qa-129"
```
