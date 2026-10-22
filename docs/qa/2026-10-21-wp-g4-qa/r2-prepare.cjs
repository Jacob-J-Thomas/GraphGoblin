const fs = require('node:fs');
const path = require('node:path');
const dir = 'docs/qa/2026-10-21-wp-g4-qa';
let s = fs.readFileSync(path.join(dir, 'served-checks.cjs'), 'utf8');
s = s
  .replaceAll("dir + '/ids.json'", "dir + '/r2-ids.json'")
  .replace("dir + '/' + name", "dir + '/r2-' + name");
s = s.replace(
  'so whether the exit’s Returns is None cannot be shown.',
  'so the exit’s Returns setting cannot be shown.',
);
let start = s.indexOf("    for (const name of ['gate', 'suppressed', 'quiet'])");
let end = s.indexOf("    await check(\n      'gate-editor'", start);
if (start < 0 || end < 0) throw Error('Import section markers missing');
s = s.slice(0, start) + s.slice(end);
start = s.indexOf("    await check(\n      'kept-before'");
end = s.indexOf('\n  } else {', start);
if (start < 0 || end < 0) throw Error('History section markers missing');
const history = `
    await check('history-editor', 'Open the imported fourth loop Done exit.', 'Returns null expression and ordinary caller destination help.', async()=>{const d=await editor(state.history.loop,'done');const text=await d.innerText();expect(text).toContain('null');await expect(d.getByRole('group',{name:'Destinations',exact:true})).toHaveAccessibleDescription('Return destinations; caller by default. No delivery when returns is none.');return {text,definition:(await api('GET','/loops/'+state.history.loop)).current.definition};});
    await check('history-before','Runs → New run; choose QA 129 omitted null; start; inspect before amendment.','succeeded; API owns result:null; Result null; no exit-returns sentence.',async()=>{await page.goto(base+'/app/runs');await page.getByRole('link',{name:'New run',exact:true}).click();await page.getByLabel('Loop',{exact:true}).selectOption(state.history.loop);const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/loops/'+state.history.loop+'/runs'));await page.getByRole('button',{name:/^(Start run|Run|Start)$/}).click();const started=await(await response).json();state.history.run=started.run.id;save('ids.json',state);await expect.poll(async()=>(await api('GET','/runs/'+started.run.id)).status,{timeout:60000}).toBe('succeeded');const x=await inspect(started.run.id,undefined,'null');expect(Object.hasOwn(x.run,'result')).toBe(true);expect(x.run.result).toBe(null);return x;});
`;
s = s.slice(0, start) + history + s.slice(end);
s = s.replace("['kept', 'null']", "['history']");
start = s.indexOf("    await check(\n      'present-null-restart'");
end = s.indexOf("    await check(\n      'missing-definition'", start);
if (start < 0 || end < 0) throw Error('Present-null markers missing');
s = s.slice(0, start) + s.slice(end);
s = s
  .replaceAll('state.null.run', 'state.history.run')
  .replace(
    "expect(x.top).not.toContain('No value was returned: Returns is None');",
    "expect(x.top).not.toContain('Returns is None');",
  );
fs.writeFileSync(path.join(dir, 'r2-served-checks.cjs'), s);
for (const [from, to] of [
  ['regression.config.cjs', 'r2-regression.config.cjs'],
  ['regression-setup.cjs', 'r2-regression-setup.cjs'],
]) {
  let x = fs
    .readFileSync(path.join(dir, from), 'utf8')
    .replaceAll('regression-setup.cjs', 'r2-regression-setup.cjs')
    .replaceAll('regression-environment.json', 'r2-regression-environment.json')
    .replaceAll("'output/playwright/qa-129'", "'docs/qa/2026-10-21-wp-g4-qa/r2-browser-output'")
    .replaceAll('gg-qa-129-e2e-', 'gg-qa-129-r2-e2e-');
  fs.writeFileSync(path.join(dir, to), x);
}
console.log('Created round-2 browser scripts; prior evidence unchanged.');
