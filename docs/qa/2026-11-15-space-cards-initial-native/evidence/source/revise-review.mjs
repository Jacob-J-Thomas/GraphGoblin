import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const file='drivers/space.playwright.js';
let source=await readFile(file,'utf8');
const changes=[
 ["offer:await offer.ariaSnapshot().catch(()=>null)", "offer:await offer.count() ? await offer.ariaSnapshot(opts) : null"],
 ["      await load(true);\n      await offer.waitFor({state:'detached',...opts});\n      await quiet(redone,3,await localDraft(),'spaced-reload');\n      const view=await snap();\n      await editLabel(redone,'ordinary-label-after-space');\n      same((await settled('label-no-fit')).viewport,view.viewport,'Ordinary label edit after spacing does not fit');", "      const editedAfterSpacing=await editLabel(redone,'ordinary-label-after-space');\n      same((await settled('label-no-fit')).viewport,deliberate.viewport,'Ordinary label edit after spacing leaves deliberate viewport unchanged');\n      await load(true);\n      await offer.waitFor({state:'detached',...opts});\n      await quiet(editedAfterSpacing,4,await localDraft(),'spaced-reload');"],
 ["new URL(request.url()).pathname===path(hold.id)+'/draft'", "new URL(request.url()).pathname===path(hold.id)+'/draft'"],
];
for(const [old,next] of changes){assert(source.includes(old),old);source=source.replace(old,next);}
await writeFile(file,source);

