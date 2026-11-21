import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const originalNow=performance.now.bind(performance);
const values=[];
Object.defineProperty(performance, 'now', {configurable:true, value:function(){
  const value=originalNow();
  const caller=new Error().stack?.split('\n')[2] ?? '';
  if(caller.includes('recovery.test.ts:')){
    values.push({value,caller});
    if(values.length === 2) writeFileSync(join(process.env.GG486_DIAG_OUTPUT,process.env.GG486_DIAG_LABEL+'-timing.json'),JSON.stringify({values,elapsedMs:values[1].value-values[0].value,thresholdMs:2000},null,2)+'\n');
  }
  return value;
}});
