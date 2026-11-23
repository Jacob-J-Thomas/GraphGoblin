import fs from'node:fs/promises';import{fixture as graphFixture}from'./graph-fixture.mjs';
export const BASELINE_SHA256='239798fc6c3d615a52a99baf547c6cd531526d14d1c674bcdd24b065c97fceb6';
export async function inputs(){const witness=JSON.parse(await fs.readFile(new URL('./baseline/editor-value-observations.json',import.meta.url),'utf8'));return{
 baselineValue:witness.confirmationInputs.correctedBefore,
 cases:[
  {key:'reserved-object',origin:'Exact auditor confirmation input',text:witness.confirmationInputs.nestedReservedBoolean,corrected:'{"marker":"corrected-after-object","allowed":false,"survivor":true}'},
  {key:'reserved-array',origin:'Exact auditor confirmation input',text:witness.confirmationInputs.insideAnArray,corrected:'{"marker":"corrected-after-array","rows":[{"allowed":false,"enabled":true}]}'},
  {key:'reserved-deep-object',origin:'New bounded recursive-object variant',text:'{"marker":"deep-changed","outer":{"__proto__":false,"enabled":true},"survivor":true}',corrected:'{"marker":"corrected-after-deep","outer":{"allowed":false,"enabled":true},"survivor":true}'},
  {key:'space-control',origin:'Exact auditor confirmation control',text:witness.confirmationInputs.spaceControl,corrected:'{"marker":"corrected-after-space","valid_key":false}'},
 ],
};}
export function fixture(name){const definition=graphFixture();definition.name=name;definition.description='Inert raw override Value refusal/correction QA; never run.';definition.nodes[2].config.harnessOptions.configOverrides={example:{previous:true},neighbor:'unchanged'};return definition;}
