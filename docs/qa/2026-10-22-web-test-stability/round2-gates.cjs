const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const results=[];
const phase=process.env.GG_CHORE_WEB_GATE_PHASE ? process.env.GG_CHORE_WEB_GATE_PHASE+'-' : '';
(async()=>{
  for (const task of process.argv.slice(2)) {
    const command='pnpm.cmd '+task;
    const name='gg-chore-web-round2-gate-'+phase+task.replaceAll(':','-');
    const log=fs.createWriteStream(path.join(process.env.TEMP,name+'.log.txt'));
    const start=Date.now();
    log.write(JSON.stringify({command,node:process.version,start:new Date().toISOString()})+'\n');
    console.log('START',command);
    const code=await new Promise((resolve,reject)=>{const p=spawn(process.env.ComSpec,['/d','/s','/c',command],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.pipe(log,{end:false});p.stderr.pipe(log,{end:false});p.on('error',reject);p.on('close',resolve);});
    const result={task,code,wallSeconds:(Date.now()-start)/1000};
    results.push(result); log.write('\nRESULT '+JSON.stringify(result)+'\n'); await new Promise(r=>log.end(r));
    fs.writeFileSync(path.join(process.env.TEMP,'gg-chore-web-round2-gates-'+phase+process.argv[2].replaceAll(':','-')+'.json'),JSON.stringify(results,null,2)+'\n');
    console.log('RESULT',JSON.stringify(result));
    if(code!==0){process.exitCode=code;break;}
  }
})().catch(e=>{console.error(e);process.exitCode=1});
