const fs=require('node:fs'),path=require('node:path');
const out=path.join(process.cwd(),'docs/qa/2026-10-22-web-test-stability');
const cases={classifier:'adds a custom classifier that starts disabled',readiness:'describes valid pending JSON accurately',cron:'announces debounced values through one stable status'};
function summarize(folder, extra=false){
  const resultFile=path.join(folder,extra?'additional-matrix-results.json':'verified-matrix-results.json');
  if(!fs.existsSync(resultFile))return[];
  return JSON.parse(fs.readFileSync(resultFile,'utf8')).map(result=>{
    const text=fs.readFileSync(path.join(folder,result.name+'.log.txt'),'utf8').replace(/\x1b\[[0-9;]*m/g,'');
    const lines=text.split(/\r?\n/),summary={...result};
    for(const label of ['Test Files','Tests','Duration'])summary[label]=lines.find(line=>new RegExp('^\\s*'+label+'\\s+').test(line))?.trim();
    summary.coverage=Object.fromEntries(['Statements','Branches','Functions','Lines'].map(label=>[label,lines.find(line=>line.startsWith(label+' '))?.trim()]));
    summary.cases=Object.fromEntries(Object.entries(cases).map(([label,pattern])=>{const line=lines.find(line=>line.includes(pattern));return[label,line?.match(/ (\d+)ms(?:\s|$)/)?.[1]||null]}));
    summary.failures=lines.filter(line=>/^\s*FAIL\s+/.test(line)||line.includes('Test timed out')||line.includes('Worker exited')||line.includes('Worker startup'));
    return summary;
  });
}
const result={before:summarize(path.join(process.env.TEMP,'gg-chore-web-round2-before')),after:[...summarize(path.join(out,'round2-after')),...summarize(path.join(out,'round2-after'),true)]};
fs.writeFileSync(path.join(process.env.TEMP,'gg-chore-web-round2-summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
