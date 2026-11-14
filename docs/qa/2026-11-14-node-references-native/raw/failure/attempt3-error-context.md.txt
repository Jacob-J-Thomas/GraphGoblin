# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rename-references.spec.ts >> focus follows the remounted form, and unfinished input elsewhere survives the rename
- Location: e2e\rename-references.spec.ts:593:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 5
+ Received  + 1

- Object {
-   "key": Object {
-     "type": "string",
-   },
- }
+ Object {}
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: GraphGoblin
    - navigation "Main" [ref=e22]:
      - link "Chat" [ref=e23] [cursor=pointer]:
        - /url: /app/chat
      - link "Loops" [ref=e25] [cursor=pointer]:
        - /url: /app/loops
      - link "Runs" [ref=e27] [cursor=pointer]:
        - /url: /app/runs
      - link "Events" [ref=e29] [cursor=pointer]:
        - /url: /app/events
      - link "Settings" [ref=e31] [cursor=pointer]:
        - /url: /app/settings
  - generic [ref=e33]:
    - banner [ref=e34]:
      - link "Loops" [ref=e35] [cursor=pointer]:
        - /url: /app/loops
      - generic [ref=e36]: /
      - heading "Rename focus and held text [52f112e9-1]" [level=1] [ref=e37]
      - generic [ref=e38]: draft only
      - generic [ref=e40]: All changes saved
      - generic [ref=e44]:
        - button "Undo edit loop settings" [ref=e45] [cursor=pointer]
        - button "Redo" [disabled] [ref=e49]
        - link "Open in Runs" [disabled] [ref=e53]
        - generic [ref=e56]: "Publish the loop first: runs start from a published version."
        - button "2 errors" [ref=e58] [cursor=pointer]
        - button "Publish" [ref=e61] [cursor=pointer]
    - status [ref=e66]:
      - paragraph [ref=e70]: Renamed work to draft
      - generic [ref=e72]:
        - paragraph [ref=e73]: Updated 2 references in expressions, templates and mutation paths, and 3 connections. Plain text, JSON values and scripts are not changed.
        - paragraph [ref=e74]: Undo reverses the whole rename.
      - button "Dismiss notice" [ref=e75] [cursor=pointer]
    - generic [ref=e79]:
      - complementary [ref=e80]:
        - generic [ref=e81]:
          - button "Hide palette" [expanded] [ref=e82] [cursor=pointer]
          - heading "Palette" [level=2] [ref=e85]
        - navigation "Node palette" [ref=e87]:
          - button "Add Trigger node" [ref=e88]:
            - generic [ref=e92]: Trigger
            - generic [ref=e93]: Starts a run
          - button "Add Decision node" [ref=e94]:
            - generic [ref=e99]: Decision
            - generic [ref=e100]: Chooses a route and can limit repeats
          - button "Add Inference node" [ref=e101]:
            - generic [ref=e106]: Inference
            - generic [ref=e107]: Hands work to a harness
          - button "Add Script node" [ref=e108]:
            - generic [ref=e112]: Script
            - generic [ref=e113]: Runs a program
          - button "Add Mutate node" [ref=e114]:
            - generic [ref=e119]: Mutate
            - generic [ref=e120]: Changes the context thread
          - button "Add Subloop node" [ref=e121]:
            - generic [ref=e126]: Subloop
            - generic [ref=e127]: Runs another loop
          - button "Add Wait node" [ref=e128]:
            - generic [ref=e132]: Wait
            - generic [ref=e133]: Parks until input, time, or a signal
          - button "Add Heartbeat node" [ref=e134]:
            - generic [ref=e138]: Heartbeat
            - generic [ref=e139]: Polls on an interval
          - button "Add Exit node" [ref=e140]:
            - generic [ref=e144]: Exit
            - generic [ref=e145]: Finishes with an outcome and return value
      - main [ref=e146]:
        - application [ref=e148]:
          - generic [ref=e150]:
            - generic:
              - generic:
                - img:
                  - group "start out to draft" [ref=e151] [cursor=pointer]
                - img:
                  - group "draft out to loop-gate" [ref=e154] [cursor=pointer]
                - img:
                  - group "loop-gate Again (again) to draft" [ref=e157] [cursor=pointer]:
                    - generic [ref=e160]: Again
                - img:
                  - group "loop-gate Stop (stop) to done" [ref=e162] [cursor=pointer]:
                    - generic [ref=e165]: Stop
                - img:
                  - group "loop-gate Limit reached (limit-reached) to done" [ref=e167] [cursor=pointer]:
                    - generic [ref=e170]: Limit reached
              - generic:
                - group "Trigger Start (start)" [active] [ref=e172]:
                  - generic [ref=e173]:
                    - generic [ref=e174]:
                      - generic [ref=e178]: Trigger
                      - button "1 issue on start" [ref=e180] [cursor=pointer]
                    - generic [ref=e183]:
                      - generic [ref=e184]: Start
                      - generic [ref=e185]: start
                      - generic [ref=e187]:
                        - text: out
                        - generic "start output out (out)" [ref=e188]
                - group "Inference Work (draft)" [ref=e189]:
                  - generic [ref=e190]:
                    - generic "draft input" [ref=e191]
                    - generic [ref=e192]: Inference
                    - generic [ref=e198]:
                      - generic [ref=e199]: Work
                      - generic [ref=e200]: draft
                      - generic [ref=e202]:
                        - text: out
                        - generic "draft output out (out)" [ref=e203]
                - group "Decision Gate (loop-gate)" [ref=e204]:
                  - generic [ref=e205]:
                    - generic "loop-gate input" [ref=e206]
                    - generic [ref=e207]: Decision
                    - generic [ref=e213]:
                      - generic [ref=e214]: Gate
                      - generic [ref=e215]: loop-gate
                      - generic [ref=e216]:
                        - generic [ref=e217]:
                          - text: Again
                          - generic "loop-gate output Again (again)" [ref=e218]
                        - generic [ref=e219]:
                          - text: Stop
                          - generic "loop-gate output Stop (stop)" [ref=e220]
                        - generic [ref=e221]:
                          - text: Limit reached
                          - generic "loop-gate output Limit reached (limit-reached)" [ref=e222]
                - group "Exit Done (done)" [ref=e223]:
                  - generic [ref=e224]:
                    - generic "done input" [ref=e225]
                    - generic [ref=e226]: Exit
                    - generic [ref=e231]:
                      - generic [ref=e232]: Done
                      - generic [ref=e233]: done
          - generic "Control Panel" [ref=e234]:
            - button "Zoom In" [ref=e235] [cursor=pointer]
            - button "Zoom Out" [ref=e238] [cursor=pointer]
            - button "Fit View" [ref=e241] [cursor=pointer]
            - button "Toggle Interactivity" [ref=e244] [cursor=pointer]
          - link "React Flow attribution" [ref=e248] [cursor=pointer]:
            - /url: https://reactflow.dev?utm_source=attribution
            - text: React Flow
      - complementary [ref=e251]:
        - generic [ref=e252]:
          - heading "Loop settings" [level=2] [ref=e253]
          - button "Hide loop settings" [expanded] [ref=e254] [cursor=pointer]
        - region "Loop settings" [ref=e258]:
          - paragraph [aria-hidden] [ref=e259]: Required fields are marked *
          - generic [ref=e260]:
            - generic [ref=e261]:
              - generic [ref=e262]: Name
              - generic [aria-hidden] [ref=e263]: "*"
            - textbox "Name" [ref=e264]: Rename focus and held text [52f112e9-1]
          - generic [ref=e265]:
            - generic [ref=e266]: Description
            - textbox "Description" [ref=e267]
          - heading "Settings" [level=3] [ref=e268]
          - paragraph [ref=e269]: Maximum node visits is a safety cap against unintended cycles. Use a decision gate's maximum passes for an intentional repeat. The elapsed execution deadline includes waits and pauses. There is no run deadline unless you set one. Structured completion milliseconds bounds each LLM decision evaluation or output-transform repair through the structured port when Limited; it defaults to Unlimited. Same-session inference schema repairs follow the node timeout. Visits and passes can also be explicitly set to Unlimited; cancellation remains available.
          - form "Loop settings form" [ref=e270]:
            - generic [ref=e272]:
              - group "Working directory" [ref=e273]:
                - generic [ref=e275]:
                  - generic [ref=e276]: Kind
                  - combobox "Kind" [ref=e278] [cursor=pointer]:
                    - option "fixed"
                    - option "template" [selected]
                    - option "temp"
                - generic [ref=e279]:
                  - generic [ref=e280]:
                    - generic [ref=e281]:
                      - generic [ref=e282]: Template
                      - generic [aria-hidden] [ref=e283]: "*"
                    - generic [ref=e284]: Liquid
                  - generic [ref=e285]:
                    - generic [ref=e288]:
                      - generic [ref=e290]: "1"
                      - textbox "Template" [ref=e294]:
                        - generic [ref=e295]: "/tmp/{{ outputs.draft.value }}"
                    - generic [ref=e296]: "Preview (sample thread): /tmp/"
              - group "Defaults" [ref=e297]:
                - group "By harness" [ref=e299]:
                  - paragraph [ref=e301]: Defaults keyed by their harness; omitted fields inherit only within that harness.
                  - button "Add entry" [ref=e303] [cursor=pointer]
                  - status [ref=e307]
              - generic [ref=e308]:
                - generic [ref=e309]: Maximum node visits
                - generic [ref=e311]:
                  - spinbutton "Maximum node visits" [ref=e312]: "4"
                  - combobox "Maximum node visits mode" [ref=e314] [cursor=pointer]:
                    - option "Limited" [selected]
                    - option "Unlimited"
                - paragraph [ref=e315]: Fresh entries per node. Default 10; unlimited removes this cutoff.
              - generic [ref=e316]:
                - generic [ref=e317]: Run deadline seconds
                - combobox "Run deadline seconds mode" [ref=e321] [cursor=pointer]:
                  - option "Limited"
                  - option "No run deadline" [selected]
                - paragraph [ref=e322]: Elapsed seconds including waits, pauses and restart downtime. No deadline by default; set seconds to add one.
                - paragraph [ref=e323]: No deadline; set one to stop a forgotten run.
              - generic [ref=e324]:
                - generic [ref=e325]: Structured completion milliseconds
                - combobox "Structured completion milliseconds mode" [ref=e329] [cursor=pointer]:
                  - option "Limited"
                  - option "Unlimited" [selected]
                - paragraph [ref=e330]: Milliseconds per LLM decision evaluation or output-transform repair through the structured port. Same-session inference schema repairs follow the node timeout. No deadline by default; Unlimited removes this cutoff.
                - paragraph [ref=e331]: No completion deadline; LLM decisions and repairs remain cancellable.
              - generic [ref=e332]:
                - generic [ref=e333]: Subloop depth limit
                - spinbutton "Subloop depth limit" [ref=e335]: "8"
          - generic [ref=e336]:
            - heading "Variables" [level=3] [ref=e337]
            - paragraph [ref=e338]: Each variable maps a name to a JSON Schema.
          - form "Variables form" [ref=e339]:
            - group "Variables" [ref=e342]:
              - generic [ref=e343]: Variables *
              - generic [ref=e344]:
                - generic [ref=e345]:
                  - generic [ref=e346]: Key
                  - textbox "Variables key 1" [ref=e347]: key
                - button "Remove variables key" [ref=e349] [cursor=pointer]
                - generic [ref=e353]:
                  - generic [ref=e354]:
                    - generic [ref=e355]:
                      - generic [ref=e356]: Value
                      - generic [aria-hidden] [ref=e357]: "*"
                    - generic [ref=e358]: JSON
                  - generic [ref=e359]:
                    - generic [ref=e363]:
                      - generic [ref=e365]: "1"
                      - textbox "Variables value 1" [invalid] [ref=e369]:
                        - generic [ref=e370]: "[1,"
                    - paragraph [ref=e372]:
                      - text: "Invalid JSON: Unexpected end of JSON input"
                      - button "Discard the unparsed text" [ref=e373] [cursor=pointer]
              - button "Add entry" [ref=e376] [cursor=pointer]
              - status [ref=e380]
```

# Test source

```ts
  630 |           ],
  631 |           maxPasses: 3,
  632 |         },
  633 |         ui: { x: 520, y: 80 },
  634 |       },
  635 |       {
  636 |         id: 'done',
  637 |         kind: 'exit',
  638 |         label: 'Done',
  639 |         config: { returns: 'outputs.work.value' },
  640 |         ui: { x: 800, y: 80 },
  641 |       },
  642 |     ],
  643 |     edges: [
  644 |       { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
  645 |       { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'gate', port: 'in' } },
  646 |       { id: 'e3', from: { node: 'gate', port: 'again' }, to: { node: 'work', port: 'in' } },
  647 |       { id: 'e4', from: { node: 'gate', port: 'stop' }, to: { node: 'done', port: 'in' } },
  648 |       { id: 'e5', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'done', port: 'in' } },
  649 |     ],
  650 |   });
  651 |   await page.goto(`/app/loops/${loopId}/edit`);
  652 |   await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  653 |   await saved(page);
  654 | 
  655 |   // Unfinished input in two other places: the variables JSON and the trigger's schedule.
  656 |   await showLoopPanel(page);
  657 |   await code(page, page, 'Variables value 1', '[1, ');
  658 |   await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');
  659 |   const start = await openNode(page, 'start');
  660 |   await start.getByLabel('Monday').uncheck();
  661 |   await expect(start.getByRole('alert')).toHaveText('Choose at least one day.');
  662 |   await start.getByRole('button', { name: 'Done', exact: true }).click();
  663 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  664 | 
  665 |   // Click: the id applies as focus leaves, and focus lands in the remounted form's field.
  666 |   let gate = await openNode(page, 'gate');
  667 |   const passes = () => gate.getByLabel('Maximum passes', { exact: true });
  668 |   await gate.getByLabel('Node id').fill('check');
  669 |   await passes().click();
  670 |   await expect(gate).toHaveAccessibleName('Edit decision check');
  671 |   await expect(codeText(gate, 'Jsonata')).toHaveText(
  672 |     'counters.nodeVisits.check > 2 ? "stop" : "again"',
  673 |   );
  674 |   await expect(passes()).toBeFocused();
  675 |   expect(await passes().evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  676 |   await page.keyboard.press('ControlOrMeta+A');
  677 |   await page.keyboard.type('4');
  678 |   await gate.getByRole('button', { name: 'Done', exact: true }).click();
  679 |   await expect
  680 |     .poll(async () => nodeOf((await serverDraft(request, loopId)).definition, 'check')?.config, {
  681 |       timeout: 30_000,
  682 |     })
  683 |     .toMatchObject({ jsonata: 'counters.nodeVisits.check > 2 ? "stop" : "again"', maxPasses: 4 });
  684 | 
  685 |   // Tab: the id applies, focus moves on to Label, and Shift+Tab returns to Node id.
  686 |   gate = await openNode(page, 'check');
  687 |   await gate.getByLabel('Node id').fill('loop-gate');
  688 |   await page.keyboard.press('Tab');
  689 |   await expect(gate).toHaveAccessibleName('Edit decision loop-gate');
  690 |   await expect(gate.locator('#node-label')).toBeFocused();
  691 |   await expect(codeText(gate, 'Jsonata')).toHaveText(
  692 |     'counters.nodeVisits."loop-gate" > 2 ? "stop" : "again"',
  693 |   );
  694 |   await page.keyboard.press('Shift+Tab');
  695 |   await expect(gate.getByLabel('Node id')).toBeFocused();
  696 |   await expect(gate.getByLabel('Node id')).toHaveValue('loop-gate');
  697 |   await gate.getByRole('button', { name: 'Done', exact: true }).click();
  698 | 
  699 |   // The settings form remounts with its repaired template; the variables text stays as typed.
  700 |   const work = await openNode(page, 'work');
  701 |   await renameInDialog(work, 'draft');
  702 |   await expect(work.getByLabel('Node id')).toBeFocused();
  703 |   await work.getByRole('button', { name: 'Done', exact: true }).click();
  704 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  705 |   await expect(codeText(page, 'Template')).toHaveText('/tmp/{{ outputs.draft.value }}');
  706 |   await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');
  707 |   const visits = page.getByRole('spinbutton', { name: 'Maximum node visits' });
  708 |   await visits.fill('4');
  709 |   await expect
  710 |     .poll(async () => (await serverDraft(request, loopId)).definition.settings, { timeout: 30_000 })
  711 |     .toMatchObject({
  712 |       maxNodeVisits: 4,
  713 |       workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.draft.value }}' },
  714 |     });
  715 |   await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');
  716 | 
  717 |   // The trigger's incomplete schedule is still held, with its message.
  718 |   const startAgain = await openNode(page, 'start');
  719 |   await expect(startAgain.getByLabel('Monday')).not.toBeChecked();
  720 |   await expect(startAgain.getByRole('alert')).toHaveText('Choose at least one day.');
  721 |   await startAgain.getByRole('button', { name: 'Done', exact: true }).click();
  722 | 
  723 |   const stored = (await serverDraft(request, loopId)).definition;
  724 |   expect(stored.nodes.map((n) => n.id)).toEqual(['start', 'draft', 'loop-gate', 'done']);
  725 |   expect(nodeOf(stored, 'done').config['returns']).toBe('outputs.draft.value');
  726 |   expect(nodeOf(stored, 'loop-gate').config['jsonata']).toBe(
  727 |     'counters.nodeVisits."loop-gate" > 2 ? "stop" : "again"',
  728 |   );
  729 |   expect(nodeOf(stored, 'start').config['expression']).toBe('30 7 * * 1');
> 730 |   expect(stored.variables).toEqual({ key: { type: 'string' } });
      |                            ^ Error: expect(received).toEqual(expected) // deep equality
  731 | });
  732 | 
  733 | test('a rename in a stale tab waits for Overwrite or Reload, and nothing is lost unseen', async ({
  734 |   context,
  735 |   request,
  736 | }) => {
  737 |   const name = uniqueLoopName('Rename stale tab');
  738 |   const loopId = await createLoop(request, {
  739 |     schemaVersion: CURRENT_DEFINITION_FORMAT,
  740 |     name,
  741 |     nodes: [
  742 |       {
  743 |         id: 'start',
  744 |         kind: 'trigger',
  745 |         label: 'Start',
  746 |         config: { type: 'manual' },
  747 |         ui: { x: 0, y: 80 },
  748 |       },
  749 |       {
  750 |         id: 'work',
  751 |         kind: 'inference',
  752 |         label: 'Work',
  753 |         config: { prompt: { template: 'Do the work.' } },
  754 |         ui: { x: 260, y: 80 },
  755 |       },
  756 |       {
  757 |         id: 'done',
  758 |         kind: 'exit',
  759 |         label: 'Done',
  760 |         config: { returns: 'outputs.work.value' },
  761 |         ui: { x: 520, y: 80 },
  762 |       },
  763 |     ],
  764 |     edges: [
  765 |       { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
  766 |       { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done', port: 'in' } },
  767 |     ],
  768 |   });
  769 |   const a = await context.newPage();
  770 |   await openDraftTab(a, loopId, name);
  771 |   const b = await context.newPage();
  772 |   await openDraftTab(b, loopId, name);
  773 |   const original = (await serverDraft(request, loopId)).definition;
  774 | 
  775 |   // Tab B saves first.
  776 |   await b.bringToFront();
  777 |   await showLoopPanel(b);
  778 |   await b.getByLabel('Description').fill('from tab B');
  779 |   await expect
  780 |     .poll(async () => (await serverDraft(request, loopId)).definition.description, {
  781 |       timeout: 30_000,
  782 |     })
  783 |     .toBe('from tab B');
  784 |   await saved(b);
  785 | 
  786 |   // Tab A renames against its stale copy: asked inside the dialog, nothing overwritten.
  787 |   await a.bringToFront();
  788 |   const dialog = await openNode(a, 'work');
  789 |   await renameInDialog(dialog, 'draft');
  790 |   await expect(dialog.getByText('The draft changed on the server')).toBeVisible({
  791 |     timeout: 30_000,
  792 |   });
  793 |   await expect(renameNotice(dialog, 'work', 'draft')).toBeVisible();
  794 |   let server = (await serverDraft(request, loopId)).definition;
  795 |   expect(server).toEqual({ ...original, description: 'from tab B' });
  796 |   await dialog.getByRole('button', { name: 'Overwrite with this copy' }).click();
  797 |   const renamed: Definition = {
  798 |     ...original,
  799 |     nodes: original.nodes.map((node) =>
  800 |       node.id === 'work'
  801 |         ? { ...node, id: 'draft' }
  802 |         : node.id === 'done'
  803 |           ? { ...node, config: { ...node.config, returns: 'outputs.draft.value' } }
  804 |           : node,
  805 |     ),
  806 |     edges: original.edges.map((edge) => ({
  807 |       ...edge,
  808 |       from: edge.from.node === 'work' ? { ...edge.from, node: 'draft' } : edge.from,
  809 |       to: edge.to.node === 'work' ? { ...edge.to, node: 'draft' } : edge.to,
  810 |     })),
  811 |   };
  812 |   await expect
  813 |     .poll(async () => (await serverDraft(request, loopId)).definition, { timeout: 30_000 })
  814 |     .toEqual(renamed);
  815 |   await expect(dialog.getByText('The draft changed on the server')).toHaveCount(0);
  816 |   await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  817 |   await saved(a);
  818 | 
  819 |   // B reloads and saves again; A renames again and this time reloads the server draft.
  820 |   await openDraftTab(b, loopId, name);
  821 |   await showLoopPanel(b);
  822 |   await b.getByLabel('Description').fill('from tab B again');
  823 |   await expect
  824 |     .poll(async () => (await serverDraft(request, loopId)).definition.description, {
  825 |       timeout: 30_000,
  826 |     })
  827 |     .toBe('from tab B again');
  828 |   await a.bringToFront();
  829 |   const second = await openNode(a, 'draft');
  830 |   await renameInDialog(second, 'final');
```