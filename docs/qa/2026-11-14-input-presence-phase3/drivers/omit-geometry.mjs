// Omit geometry on the built app: size of the revealed button, its reserved place, clearances to
// the field and the control before it, label/tag readability, and the shift when Omit appears.
//   node drivers/omit-geometry.mjs <label>
// Runs New run and Wait, coarse (hasTouch) and fine, 390 and 1280 px, on text, JSON, number and the
// raw JSON editor, plus long titles. Real Edge, disposable e2e backend on an ephemeral port.
import { context, launch, publishLoop, saveJson, startServer, VISUAL_SCHEMA } from './common.mjs';

const label = process.argv[2] ?? 'candidate';
export const LONG_SCHEMA = {
  type: 'object',
  properties: {
    first: { type: 'string', title: 'First' },
    long: {
      type: 'string',
      title:
        'Reviewer explanation of why this run should continue past the approval gate after the second check',
    },
    longJson: {
      type: 'object',
      title: 'Structured reviewer notes attached to the approval record for later audit',
      description: 'Any JSON object',
    },
  },
};

const server = await startServer();
const browser = await launch();
const rows = [];
try {
  const visual = await publishLoop(server.url, 'geometry visual', VISUAL_SCHEMA, VISUAL_SCHEMA);
  const long = await publishLoop(server.url, 'geometry long', LONG_SCHEMA, LONG_SCHEMA);
  const raw = await publishLoop(server.url, 'geometry raw', undefined, undefined);
  const cases = [
    [visual, ['comment', 'number', 'payload']],
    [long, [LONG_SCHEMA.properties.long.title, LONG_SCHEMA.properties.longJson.title]],
    [raw, ['Input (JSON)']],
  ];
  for (const [width, touch] of [[390, true], [1280, true], [1280, false], [390, false]]) {
    for (const entry of ['New run', 'Wait']) {
      for (const [loopId, fields] of cases) {
        const ctx = await context(browser, { url: server.url, width, height: 844, theme: 'light', touch });
        const page = await ctx.newPage();
        if (entry === 'New run') await page.goto(`/app/runs/new?loop=${loopId}`);
        else {
          const res = await fetch(`${server.url}/loops/${loopId}/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(loopId === raw ? {} : { input: loopId === visual ? { reason: '' } : {} }),
          });
          await page.goto(`/app/runs/${(await res.json()).run.id}`);
        }
        const form = page.getByRole('form', { name: entry === 'New run' ? 'Start run' : 'Submit input' });
        await form.waitFor();
        await page.evaluate(() => document.fonts.ready);
        for (const name of fields) {
          const field = form.getByLabel(name, { exact: true });
          const omitName = name === 'Input (JSON)' ? 'Omit input' : `Omit ${name}`;
          const omit = form.getByRole('button', { name: omitName, exact: true });
          const measure = () =>
            field.evaluate((el) => {
              const form = el.closest('form');
              const fr = form.getBoundingClientRect();
              const r = (e) => {
                if (!e) return null;
                const b = e.getBoundingClientRect();
                return { x: b.left - fr.left, y: b.top - fr.top, right: b.right - fr.left, bottom: b.bottom - fr.top, width: b.width, height: b.height };
              };
              const group = el.closest('.grid.min-w-0');
              const row = el.previousElementSibling;
              const lab = form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
              const button = row.querySelector('button');
              const slot = button ? button.parentElement : row.querySelector('span > span:first-child');
              const tag = [...row.querySelectorAll('span')].find((s) => s.textContent === 'JSON');
              const controls = [...form.querySelectorAll('input:not([type=radio]),textarea,select,button,label')]
                .filter((c) => c !== el && c !== button && c !== lab && c.getBoundingClientRect().width > 1);
              const top = (button ?? row).getBoundingClientRect().top - fr.top;
              const prevControl = controls
                .map((c) => ({ c, b: r(c) }))
                .filter(({ b }) => b.bottom <= top + 0.01)
                .sort((p, q) => q.b.bottom - p.b.bottom)[0];
              const prevGroup = group.previousElementSibling;
              const after = button ? getComputedStyle(button, '::after') : null;
              const lineHeight = parseFloat(getComputedStyle(lab).lineHeight);
              return {
                coarse: matchMedia('(pointer: coarse)').matches,
                fieldTopInForm: el.getBoundingClientRect().top - fr.top,
                formHeight: fr.height,
                field: r(el),
                row: r(row),
                rowPaddingBottom: getComputedStyle(row).paddingBottom,
                label: r(lab),
                labelLines: Math.round(lab.getBoundingClientRect().height / lineHeight),
                labelClipped: lab.scrollWidth > lab.clientWidth + 0.5,
                slot: r(slot),
                slotDisplay: slot ? getComputedStyle(slot).display : null,
                tag: r(tag),
                button: r(button),
                buttonAfterContent: after ? after.content : null,
                buttonBorderColor: button ? getComputedStyle(button).borderTopColor : null,
                previousControl: prevControl
                  ? { tag: prevControl.c.tagName, name: prevControl.c.getAttribute('aria-label') ?? prevControl.c.id, ...r(prevControl.c) }
                  : null,
                previousGroupBottom: prevGroup ? prevGroup.getBoundingClientRect().bottom - fr.top : null,
              };
            });
          const before = await measure();
          await field.fill(name === 'number' ? '5' : /json|payload|notes/i.test(name) ? '{"a":1}' : 'typed');
          await omit.waitFor();
          const after = await measure();
          const b = after.button;
          const row = {
            width,
            touch,
            entry,
            field: name,
            coarse: after.coarse,
            button: b && { width: +b.width.toFixed(2), height: +b.height.toFixed(2) },
            buttonAfterContent: after.buttonAfterContent,
            buttonBorderColor: after.buttonBorderColor,
            slotBefore: before.slot && before.slotDisplay !== 'none' ? { width: +before.slot.width.toFixed(2), height: +before.slot.height.toFixed(2) } : 'none',
            rowHeight: +after.row.height.toFixed(2),
            rowPaddingBottom: after.rowPaddingBottom,
            buttonBottomToField: +(after.field.y - b.bottom).toFixed(2),
            labelBottomToField: +(after.field.y - after.label.bottom).toFixed(2),
            previousControl: after.previousControl && `${after.previousControl.tag} ${after.previousControl.name}`,
            previousControlBottomToButton: after.previousControl ? +(b.y - after.previousControl.bottom).toFixed(2) : null,
            previousGroupBottomToButton: after.previousGroupBottom != null ? +(b.y - after.previousGroupBottom).toFixed(2) : null,
            labelRightToButton: +(b.x - after.label.right).toFixed(2),
            labelLines: [before.labelLines, after.labelLines],
            labelClipped: after.labelClipped,
            tagRightToButton: after.tag ? +(after.tag.x - b.right).toFixed(2) : null,
            tagMoved: after.tag && before.tag ? +(Math.abs(after.tag.x - before.tag.x) + Math.abs(after.tag.y - before.tag.y)).toFixed(2) : null,
            shiftField: +(after.fieldTopInForm - before.fieldTopInForm).toFixed(3),
            shiftLabel: +(after.label.y - before.label.y + (after.label.height - before.label.height)).toFixed(3),
            formHeightChange: +(after.formHeight - before.formHeight).toFixed(3),
            buttonInsideRow: b.y >= after.row.y - 0.01 && b.bottom <= after.row.bottom + 0.01,
            buttonEqualsSlotAfter: after.slot && Math.abs(after.slot.width - b.width) < 0.01 && Math.abs(after.slot.height - b.height) < 0.01,
          };
          rows.push({ ...row, before, after });
          console.log(JSON.stringify(row));
        }
        await ctx.close();
      }
    }
  }
  saveJson(`logs/omit-geometry-${label}.json`, rows);
} finally {
  await browser.close();
  await server.stop();
}
