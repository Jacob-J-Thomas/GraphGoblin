import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const prior = join(root, '..', 'history-208-independent');
const version = join(root, 'driver-v1');
const digest = b => createHash('sha256').update(b).digest('hex');
await mkdir(version);
await mkdir(join(version, 'configs'));
await mkdir(join(root, 'binding'));
await mkdir(join(root, 'manifests'));
await mkdir(join(root, 'provenance'));
for (const name of ['handoff.md', 'fixture-corrections.json', 'admission.json', 'forced-build-exit.json', 'source-binding.json', 'cleanup-final.json']) {
  await copyFile(join(prior, name), join(root, 'provenance', name));
}
for (const name of await readdir(join(prior, 'configs'))) await copyFile(join(prior, 'configs', name), join(version, 'configs', name));
for (const name of await readdir(join(prior, 'manifests'))) await copyFile(join(prior, 'manifests', name), join(root, 'manifests', name));
await copyFile(join(prior, 'binding', 'binding-before.json'), join(root, 'binding', 'binding-before.json'));
await copyFile(join(prior, 'gateway.mjs'), join(version, 'gateway.mjs'));
let driver = await readFile(join(prior, 'history.playwright.js'), 'utf8');
const replace = (old, next) => { assert.equal(driver.split(old).length, 2, old.slice(0, 100)); driver = driver.replace(old, next); };
replace("suite: '208-history-independent'", "suite: '208-history-escalation-v1'");
replace('  const phases = [];', '  const phases = [];\n  const responseReads = [];\n  let apiSerial = 0;\n  let frameSerial = 0;');
replace("    await sinkPost('frames-' + label + '.json', captured);", "    const rawFile = 'frames-' + String(++frameSerial).padStart(3, '0') + '-' + label + '.json';\n    await sinkPost(rawFile, captured);\n    phases.push({ label, rawFile, samples: captured.trace.length });");
replace("    check(response.status() === expected, method + ' ' + route + ': ' + response.status() + ' ' + (await response.text()).slice(0, 300), 'fixture');\n    return response.status() === 204 ? null : response.json();", "    const text = await response.text();\n    let body = null;\n    if (text) { try { body = JSON.parse(text); } catch { body = text; } }\n    const record = { method, route, at: Date.now(), expected, status: response.status(), headers: response.headers(), body };\n    await sinkPost('api-' + String(++apiSerial).padStart(3, '0') + '.json', record);\n    check(response.status() === expected, method + ' ' + route + ': ' + response.status() + ' ' + text.slice(0, 300), 'fixture');\n    return body;");
replace("      if (entry) { entry.status = response.status(); entry.responseAt = Date.now(); }", "      if (entry) {\n        entry.status = response.status(); entry.responseAt = Date.now();\n        if (entry.path.startsWith('/loops/')) responseReads.push(response.text().then((text) => {\n          try { entry.responseBody = JSON.parse(text); } catch { entry.responseText = text; }\n        }).catch((error) => { entry.responseReadError = String(error); }));\n      }");
replace('  const def = (record) => record.draft.definition;', "  const def = (record) => {\n    const selected = record?.draft ?? record?.current;\n    check(selected?.definition && record.draftToken, 'GET lacks a current-or-draft definition/token', 'fixture');\n    return selected.definition;\n  };");
replace("    const position = options.point ?? point;", "    const position = options.point ?? point;\n    const before = await snapshot();\n    notes.push({ label: 'fixed-input-point', direction, options, position, before });\n    if (options.enabled) check(before.directions[direction === 'undo' ? 0 : 1].disabled !== 'true', direction + ' must be enabled before the first press', 'fixture');");
replace('  async function publish() {', '  async function publish(held = true) {');
replace('    publishGate = gate();', '    publishGate = held ? gate() : undefined;');
replace("    await until(() => publishGate.used, 'held POST publish');\n    await page.getByRole('button', { name: 'Publishing…', exact: true }).waitFor({ timeout: 10000 });\n    await wait(130);\n    publishGate.release();", "    if (held) {\n      await until(() => publishGate.used, 'held POST publish');\n      await page.getByRole('button', { name: 'Publishing…', exact: true }).waitFor({ timeout: 10000 });\n      await wait(130);\n      publishGate.release();\n    }");
replace("    same(settled.current.definition, def(baseline), 'Published definition exactly matches the fixture');", "    out.checkpoints.push({ label: 'post-publish current-only readback', before: baseline, settled });\n    check(settled.current && !settled.draft && settled.loop.draftVersionId === null, 'Publish must leave current and no draft');\n    same(settled.current.definition, def(baseline), 'Published definition exactly matches the fixture');\n    same(settled.draftToken, baseline.draftToken, 'Publishing unchanged content keeps its content token');");
replace("    check(frames.some((f) => f.publish === 'Publishing…') && frames.some((f) => f.badge === 'published v1'),", "    check((!held || frames.some((f) => f.publish === 'Publishing…')) && frames.some((f) => f.badge === 'published v1'),");
replace("    const field = modal.getByRole('textbox').first();\n    if (await field.count()) {\n      await field.click({ timeout: 10000 });\n      await page.keyboard.press('Control+z');\n      await restored(knownAdd, 'Text field owns Ctrl+Z');\n    } else out.limits.push('No native modal textbox reached; text focus retention component evidence only');", "    const field = modal.getByRole('textbox', { name: 'Node id', exact: true });\n    // The node-id input stages text until blur. Exercise real native text undo before blur.\n    const textBefore = await field.inputValue();\n    const textWrites = writes().length;\n    await field.click({ timeout: 10000 });\n    await page.keyboard.press('End');\n    await page.keyboard.type('x');\n    same(await field.inputValue(), textBefore + 'x', 'Native text entry reached staged node-id');\n    await page.keyboard.press('Control+z');\n    same(await field.inputValue(), textBefore, 'Text field owns native Ctrl+Z');\n    await restored(knownAdd, 'Text field owns Ctrl+Z');\n    await wait(740);\n    check(writes().length === textWrites, 'Text-local undo must not write graph history');\n    same(def(await get()), def(prior), 'Text-local undo kept complete server graph');");
replace("    const first = await open(true);\n    check(first.some((f) => f.validation === 'Checking…') && first.some((f) => f.validation === 'Ready to publish'),\n      'No first-paint checking/ready transition in trace', 'fixture');\n    if (group === 'h-d1') await samplerControl();\n    await historyAttributes(true);\n    await focusOrder();\n    await trace('focus-order');\n    await mark('disabled-top-row');\n    await hitHistory('undo', { top: true, hold: 250 });\n    await wait(740);\n    check(writes().length === 0 && (await snapshot()).focused === 'undo', 'Disabled control must keep focus without writer');\n    await restored(def(baseline), 'Disabled case');\n    await verifyPress('disabled-top-row', 'undo');\n    await publish();", "    const resumeD1 = group === 'h-d1';\n    const first = await open(!resumeD1);\n    await historyAttributes(true);\n    if (!resumeD1) {\n      check(first.some((f) => f.validation === 'Checking…') && first.some((f) => f.validation === 'Ready to publish'),\n        'No first-paint checking/ready transition in trace', 'fixture');\n      await focusOrder();\n      await trace('focus-order');\n      await mark('disabled-top-row');\n      await hitHistory('undo', { top: true, hold: 250 });\n      await wait(740);\n      check(writes().length === 0 && (await snapshot()).focused === 'undo', 'Disabled control must keep focus without writer');\n      await restored(def(baseline), 'Disabled case');\n      await verifyPress('disabled-top-row', 'undo');\n    }\n    // D1's first paint, focus, disabled press, held Publish and 1px control already passed.\n    // Ordinary publication establishes the exact current-only baseline needed for the remaining actions.\n    await publish(!resumeD1);");
driver = driver.replaceAll("{ top: true, hold: 250 }), current", "{ top: true, hold: 250, enabled: true }), current");
replace("    if (['h-d1','h-r512'].includes(group)) current = await dialog(current);\n    return current;", "    if (['h-d1','h-r512'].includes(group)) current = await dialog(current);\n    current = await heldValidation(current);\n    return current;");
const validation = `  async function heldValidation(prior) {
    // Return to the valid published graph, then make one distinct valid edit through the UI.
    // A fresh label changes the validation key; undoing an old edit can hit a cached valid key.
    if (JSON.stringify(canonical(def(prior))) !== JSON.stringify(canonical(def(baseline)))) {
      prior = await apply('prepare valid validation fixture', () => hitHistory('undo', { enabled: true }), prior, def(baseline));
    }
    await readyLabel.waitFor({timeout:10000});
    await trace('validation-fixture-ready');
    const card = page.locator('.react-flow__node[data-id="work"]');
    await card.click({timeout:10000});
    const modal = page.locator('dialog:modal');
    await modal.waitFor({timeout:10000});
    const label = 'Validation hold ' + crypto.randomUUID().slice(0, 7);
    const expected = {...def(baseline), nodes:def(baseline).nodes.map(node => node.id === 'work' ? {...node,label} : node)};
    validationGate = gate();
    const count = writes().length;
    await modal.getByRole('textbox', {name:'Label',exact:true}).fill(label);
    await page.keyboard.press('Escape');
    await modal.waitFor({state:'hidden',timeout:10000});
    const changed = await saved('valid label before held validation', count, prior, expected);
    await until(() => validationGate.used, 'distinct valid revision held validation');
    check((await snapshot()).validation === 'Checking…', 'Held fresh valid validation must be Checking', 'fixture');
    // Exclude modal inertness from the fixed-hittarget interval; retain its raw frames separately.
    await trace('validation-edit-dialog', false);
    await mark('validation-held-enabled-undo');
    const position = await button('undo').evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.x + r.width/2;
      const hit = y => el.contains(document.elementFromPoint(x,y));
      const y0 = Math.ceil(r.top);
      const y = [y0-1,y0,y0+1].find(row => hit(row) && !hit(row-1));
      return y === undefined ? null : {x,y};
    });
    check(position && (await snapshot()).directions[0].disabled !== 'true', 'Held validation needs enabled upper-row Undo', 'fixture');
    notes.push({label:'held validation locked upper row', position, expected, prior:changed});
    const undoCount = writes().length;
    await page.mouse.move(position.x,position.y);
    await page.mouse.down();
    try {
      await wait(250);
      validationGate.release();
      await readyLabel.waitFor({timeout:10000});
      await mark('ready-during-enabled-hold');
    } finally { await page.mouse.up(); }
    const undone = await saved('held-validation Undo', undoCount, changed, def(baseline));
    const frames = await verifyPress('held-validation-transition','undo');
    const down = frames.find(f => f.type === 'mousedown' && f.input.target === 'undo');
    const up = frames.find(f => f.type === 'mouseup' && f.t >= down.t);
    check(frames.some(f => f.t <= down.t && f.validation === 'Checking…') &&
      frames.some(f => f.t > down.t && f.t < up.t && f.validation === 'Ready to publish'),
      'Checking to Ready must visibly resolve during the enabled native hold', 'unwitnessed');
    await restored(def(baseline), 'Held validation restored complete graph');
    return undone;
  }

`;
replace('  async function inPageBanner(prefix, where) {', validation + '  async function inPageBanner(prefix, where) {');
const ownershipStart = driver.indexOf('  async function ownership() {');
const ownershipEnd = driver.indexOf('  async function n360() {', ownershipStart);
assert(ownershipStart > 0 && ownershipEnd > ownershipStart);
driver = driver.slice(0,ownershipStart) + `  async function ownership() {
    // Only the previously unreached native error subphase. Other ownership transitions passed.
    const name = 'QA missing escalation ' + crypto.randomUUID().slice(0,7);
    loopId = await create(name);
    await page.reload();
    const entry = page.getByRole('link',{name:'Edit '+name,exact:true});
    await entry.waitFor({timeout:12000});
    await api('DELETE',path(loopId),204);
    await mark('load-error-online-retry');
    await entry.click({timeout:10000});
    await page.getByText('Could not load loop',{exact:true}).waitFor({timeout:10000});
    const failed = requests.filter(req => req.method === 'GET' && req.path === path(loopId) && req.status === 404);
    check(failed.length === 2, 'Expected first real GET404 and configured one online retry', 'fixture');
    check((await snapshot()).online, '404 retries must complete while online', 'fixture');
    await mark('native-error-established-online');
    await page.context().setOffline(true);
    const banner = await inPageBanner('You are offline','shell');
    check(await historySlot.count() === 0, 'Unavailable editor rendered claimed history');
    await page.getByText('Could not load loop',{exact:true}).waitFor({timeout:10000});
    out.checkpoints.push({label:'native error owns one shell status after both 404s', failed, banner});
    await trace('ownership-native-load-error',false);
    await page.context().setOffline(false);
    out.limits.push('Prior shell/loading/loaded/route/re-entry passes retained without rerun. Voice staging and unrelated notices remain source/component evidence only');
  }

` + driver.slice(ownershipEnd);
replace("    await sinkPost('actions.json',{out,notes,phases,requests});", "    await Promise.allSettled(responseReads);\n    await sinkPost('actions.json',{out,notes,phases,requests});");
await writeFile(join(version,'history.playwright.js'), driver, {flag:'wx'});
let runner = await readFile(join(prior,'run-case.mjs'),'utf8');
runner = runner.replace("const base = here;", "const base = dirname(here);");
runner = runner.replace("assert(admission.nativeGrant && admission.authorizedGroups.includes(group), 'Missing root grant for the exact native group');", "assert(admission.nativeGrant && admission.authorizedGroups.includes(group), 'Missing root grant for the exact native group');\nconst frozen = JSON.parse(await readFile(join(base, 'driver-v1-manifest.json'), 'utf8'));\nassert.equal(createHash('sha256').update(await readFile(join(base, 'driver-v1-manifest.json'))).digest('hex'), admission.driverManifestSha256);\nfor (const [path, expected] of Object.entries(frozen.files)) assert.equal(createHash('sha256').update(await readFile(join(base,path))).digest('hex'), expected, 'Frozen driver changed: ' + path);");
runner = runner.replaceAll("first|correction", "initial|correction").replace("attempt !== 'first'", "attempt !== 'initial'");
runner = runner.replace("join(here, 'fixture-corrections.json')", "join(base, 'fixture-corrections.json')");
runner = runner.replace("  assert(correction.some((row)", "  assert(correction.length <= 2, 'Escalation correction-batch cap exhausted');\n  assert(correction.some((row)");
runner = runner.replace("'gg208h-'", "'gg208e-'");
runner = runner.replace("await writeFile(join(output, 'raw', match[1]), body);", "await writeFile(join(output, 'raw', match[1]), body, {flag:'wx'});");
runner = runner.replace("const worktree = admission.checkout;", "assert(['h-d1','h-d2','h-n768','h-r512','ownership-d1','ownership-r512'].includes(group), 'Only remaining matrix is admitted');\nconst worktree = admission.checkout;");
await writeFile(join(version,'run-case.mjs'),runner,{flag:'wx'});
let cleanup = await readFile(join(prior,'verify-cleanup.ps1'),'utf8');
cleanup = cleanup.replace("$PSScriptRoot", "(Join-Path $PSScriptRoot '..')").replaceAll('gg208h-', 'gg208e-');
await writeFile(join(version,'verify-cleanup.ps1'),cleanup,{flag:'wx'});
await writeFile(join(root,'fixture-corrections.json'),'[]\n',{flag:'wx'});
const oldAdmission = JSON.parse(await readFile(join(prior,'admission.json'),'utf8'));
const admission = {...oldAdmission,status:'offline-ready-awaiting-exclusive-slot',buildGrant:null,nativeGrant:null,
  priorCorrections:'Two exhausted; retained separately in provenance/fixture-corrections.json',
  escalation:{model:'gpt-6-astra',reasoning:'xhigh',authorization:'Root explicit higher-tier QA recovery',formalScans:0,maxFixtureCorrectionBatches:2},
  authorizedGroups:['h-d1','h-d2','h-n768','h-r512','ownership-d1','ownership-r512']};
delete admission.buildGrant;
await writeFile(join(root,'admission-offline.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:version,driverSha256:digest(driver),sourcePriorSha256:digest(await readFile(join(prior,'history.playwright.js')))}));
