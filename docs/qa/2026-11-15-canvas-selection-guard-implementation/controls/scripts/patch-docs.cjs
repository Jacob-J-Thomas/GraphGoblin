// Documentation edits for the Remove connection click-count rule (#207). Run once from the repo
// root; each anchor must exist exactly once, or nothing is written.
const fs = require('fs');

function patch(file, edits) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    const parts = text.split(from);
    if (parts.length !== 2) throw new Error(`${file}: anchor found ${parts.length - 1} times: ${from.slice(0, 70)}`);
    text = parts.join(to);
  }
  fs.writeFileSync(file, text);
  console.log('patched', file);
}

patch('docs/09-frontend-and-pwa.md', [
  [
    "when the store would refuse the removal, and moves focus to **Undo** afterwards. One connection is removed at a time",
    "when the store would refuse the removal, and moves focus to **Undo** afterwards. It acts on a click the browser counts as 0 or 1 (Enter, Space and a script's `click()` report 0) and not on a later click of a double or triple click, which the browser counts above 1 (#207). Clicking a connection's line selects it and draws its toolbar under the pointer, so the second click of a double click can land on **Remove connection**; it then removes nothing and moves focus back to the connection, where Delete or Backspace still removes it. Its click ends on the button first, so Control or Meta cannot select the connection again and toggle it off. The rule follows the browser's count, not timing or position: a separate click that the browser counts as 1 removes the connection, and one Undo restores it. How a browser counts touch or pen clicks, and a run of more than three, is not established here. One connection is removed at a time",
  ],
  [
    "and the pan gate and the store's reason beside it)",
    "and the pan gate and the store's reason beside it; Remove connection's click counts: 2 and 3 refused on an automatic and a manual route with focus back on the connection and the draft, history, selection and announcement unchanged, 0 (Enter, Space, `click()`) and 1 acting once, with one Undo)",
  ],
  [
    "and the first deliberate Remove connection click with two Undos)",
    "and the first deliberate Remove connection click with two Undos; the second click, counted 2, and `dblclick` of a double click on **Remove connection** after its first click selected the connection, also with the multi-selection key held, which remove nothing, cancel nothing and leave the viewport as it was, then one click counted 1 that removes once, with one Undo)",
  ],
  [
    "and its recovery with one Undo), `e2e/exit-primitives.spec.ts`",
    "and its recovery with one Undo), `e2e/edge-routes.spec.ts` (a double click on a connection's line under its selected toolbar selects it and removes and writes nothing, then a separate Remove connection click removes it once, with one Undo), `e2e/exit-primitives.spec.ts`",
  ],
]);

patch('docs/guide/02-build-a-loop.md', [
  [
    "Scrolling to zoom, touch and **Fit View** never dim them.\n",
    "Scrolling to zoom, touch and **Fit View** never dim them.\n\nWhen you double-click or triple-click a connection, the first click selects it and its toolbar appears under the pointer. A later click of that double or triple click, as your browser counts it, does not remove the connection: **Remove connection** ignores it and the connection stays selected, so you can still press **Delete** or **Backspace**. A separate click on **Remove connection** removes the connection, and **Undo** brings it back.\n",
  ],
]);

patch('CHANGELOG.md', [
  [
    "or the reset is undone. Removing a\n",
    "or the reset is undone. **Remove connection** ignores a later click of a double or triple click, as\n  the browser counts it, and the connection stays selected, so double-clicking a line no longer removes it\n  by landing on the toolbar the first click drew; a separate click still removes it. Removing a\n",
  ],
]);
