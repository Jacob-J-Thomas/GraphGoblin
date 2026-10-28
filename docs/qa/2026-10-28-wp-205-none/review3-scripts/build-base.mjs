import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.cwd(), scratch=path.dirname(fileURLToPath(import.meta.url)), base=path.join(scratch,'base');
const require=createRequire(path.join(root,'package.json')), ts=require('typescript');
let count=0;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const top of ['packages','apps']) for(const name of fs.readdirSync(path.join(base,top))){
 const pkg=path.join(base,top,name), src=path.join(pkg,'src'); if(!fs.existsSync(src)) continue;
 for(const file of walk(src)){
  const dest=path.join(pkg,'dist',path.relative(src,file)).replace(/\.tsx?$/,'.js');fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(/\.d\.ts$/.test(file))continue;
  if(/\.tsx?$/.test(file)){
   const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX,verbatimModuleSyntax:true}});
   fs.writeFileSync(dest,result.outputText);count++;
  }else fs.copyFileSync(file,dest);
 }
}
const loader=`import {registerHooks} from 'node:module';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {pathToFileURL,fileURLToPath} from 'node:url';\nconst root=${JSON.stringify(root)},base=${JSON.stringify(base)};\nregisterHooks({resolve(s,c,n){\n if(c.parentURL?.startsWith(pathToFileURL(base).href)){\n  if(s.startsWith('@graphgoblin/')){\n   const [scope,name,...rest]=s.split('/');let pkg;for(const top of ['packages','apps']){const p=path.join(base,top,name,'package.json');if(fs.existsSync(p)){pkg=p;break;}}\n   if(pkg){let exp=JSON.parse(fs.readFileSync(pkg,'utf8')).exports;let t=exp[rest.length?'./'+rest.join('/') : '.'];if(typeof t==='object')t=t.import??t.default;if(typeof t==='object')t=t.default;return {url:pathToFileURL(path.resolve(path.dirname(pkg),t)).href,shortCircuit:true};}\n  }\n  if(!s.startsWith('.')&&!s.startsWith('/')&&!s.startsWith('file:')&&!s.startsWith('node:'))return n(s,{...c,parentURL:pathToFileURL(path.join(root,path.relative(base,fileURLToPath(c.parentURL)))).href});\n }return n(s,c);\n}});\n`;
fs.writeFileSync(path.join(scratch,'base-loader.mjs'),loader);
console.log(JSON.stringify({base:'a4fee9a9',files:count,method:'git archive exact base sources, TypeScript ES2022 transpilation; module hooks use unchanged installed dependencies; no links',root:base}));