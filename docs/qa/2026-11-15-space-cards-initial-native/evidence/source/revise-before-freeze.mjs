import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const file = 'drivers/space.playwright.js';
let source = await readFile(file,'utf8');
const changes = [
 ["kind:'expression',expression:", "kind:'expression',jsonata:"],
 ["    let sample;\n", ""],
 ["{sample,firstPoint:", "{firstPoint:"],
 [" && pane.contains(hit)", ""],
 ["      const probe=window.__spaceQA,pane=document.querySelector('.react-flow__pane');\n      for(const node", "      const probe=window.__spaceQA;\n      for(const node"],
 ["    await settled('opening-fit');", "    await page.getByText('The editor is available. Checking the server and this device before saving changes.',{exact:true}).waitFor({state:'hidden',...opts});\n    await settled('opening-fit');"],
 ["      await quiet(server,1,device,'owner-server-reload');", "      same([device?.synced,device?.baseToken,device?.definition],[true,server.draftToken,definition(server)],'Confirmed owner reload synchronizes exact authoritative device copy');\n      await quiet(server,1,device,'owner-server-reload');"],
 ["    same(after.selected,before.selected,label+' selection ownership preserved');", "    same(after.selected,before.selected,label+' selection ownership preserved');\n    check(!rows.some(row=>row.modal || JSON.stringify(row.selected)!==JSON.stringify(before.selected)),label+' no transient editor or selection side effect');"],
 ["    if(transforms.size!==2)failures.push('Unexpected observed viewport transform count '+transforms.size);", "    if(transforms.size!==2)failures.push('Unexpected observed viewport transform count '+transforms.size);\n    if(pointers[1]?.viewport && pointers[1].viewport.join(',')!==before.viewport.join(',') && pointers[1].viewport.join(',')!==after.viewport.join(',')) failures.push('Unexpected transform at second real hit');"],
];
for(const [old,next] of changes){assert(source.includes(old),old);source=source.replace(old,next);}
await writeFile(file,source);

