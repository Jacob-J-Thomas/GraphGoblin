import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const [admissionFile,outputFile,comparisonFile]=process.argv.slice(2);
const admission=JSON.parse(await readFile(resolve(admissionFile),'utf8'));
const binding=JSON.parse(await readFile(join(root,'binding/binding-before.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const ts='packages/domain/src/expression-references.ts',js='packages/domain/dist/expression-references.js';
const actual=await readFile(join(admission.checkout,js),'utf8');
const source=await readFile(join(admission.checkout,ts));
assert.equal(sha(source),binding.sourceReadback[ts]);
const manifest=await readFile(join(root,'manifests/packages_domain_dist.sha256'),'utf8');
assert(manifest.includes(sha(actual)+' *'+js+'\n'));
const mapBytes=await readFile(join(admission.checkout,js+'.map'));
assert(manifest.includes(sha(mapBytes)+' *'+js+'.map\n'));
const jsMap=JSON.parse(mapBytes);
assert.deepEqual(jsMap.sources,['../src/expression-references.ts']);
assert.equal(jsMap.file,'expression-references.js');
let embedded;
for(const path of Object.keys(binding.critical).filter(path=>path.endsWith('.js.map'))){
  const map=JSON.parse(await readFile(join(admission.checkout,path),'utf8'));
  const index=map.sources.findIndex(source=>source.endsWith('/'+js));
  if(index>=0){assert.equal(map.sourcesContent[index],actual);embedded={path,sourceName:map.sources[index],sha256:sha(actual)};}
}
assert(embedded,'Compiled domain source absent from browser map');
const report={head:binding.head,tree:binding.tree,source:{path:ts,sha256:sha(source)},compiled:{path:js,sha256:sha(actual)},
  compiledSourceMap:{path:js+'.map',sha256:sha(mapBytes),sources:jsMap.sources,sourceContentEmbedded:Boolean(jsMap.sourcesContent)},
  browserEmbedded:embedded,buildLogSha256:binding.buildLogSha256,
  evidence:'Fresh forced build and exact Git source; browser embeds identical emitted JS. TypeScript map links source path but does not embed TS bytes.'};
if(comparisonFile)assert.deepEqual(report,JSON.parse(await readFile(resolve(comparisonFile),'utf8')));
await writeFile(resolve(outputFile),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'domain-compiled-map-bound',head:report.head,sha256:sha(JSON.stringify(report,null,2)+'\n')}));
