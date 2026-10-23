const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const files=['apps/web/src/editor/EditorPage.test.tsx','apps/web/src/forms/cron/control.test.tsx','apps/web/src/settings/sections/ClassifierModelsSection.test.tsx','apps/web/src/__fixtures__/user.ts','apps/web/src/editor/EditorPage.tsx','apps/web/src/forms/cron/control.tsx','apps/web/src/settings/sections/ClassifierModelsSection.tsx','apps/web/vitest.config.ts','tooling/vitest.shared.mjs'];
const record={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),gitBlob:execFileSync('git',['hash-object','--path',file,file],{encoding:'utf8'}).trim()}))};
fs.writeFileSync('docs/qa/2026-10-22-web-test-stability/round2-after/tested-sources.json',JSON.stringify(record,null,2)+'\n');
const original=execFileSync('git',['show','HEAD:apps/web/src/settings/sections/ClassifierModelsSection.test.tsx'],{encoding:'utf8'});
const segment=original.slice(original.indexOf("  it('adds a custom classifier"),original.indexOf("  it('review: keeps Add unavailable"));
const strings=[...segment.matchAll(/await user\.type\([^\n]*, '([^']+)'\);/g)].map(m=>m[1]);
console.log(JSON.stringify({fixtureStrings:strings.length,characters:strings.reduce((n,s)=>n+s.length,0),pastedInputEvents:strings.length}));
