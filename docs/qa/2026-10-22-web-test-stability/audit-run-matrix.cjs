const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const root = process.cwd();
const output = __dirname;
const results = [];
fs.writeFileSync(path.join(output,'active-matrix-pid.txt'),String(process.pid));
async function run(name, serial) {
  const start = Date.now();
  const workers = Array.from({length: 3}, () => new Worker(`const {parentPort}=require('node:worker_threads'); parentPort.postMessage('ready'); let n=0; for (;;) { for(let i=0;i<1000000;i++) n+=Math.sqrt(i); if(n>1e100) n=0; }`, {eval: true}));
  await Promise.all(workers.map(worker => new Promise(resolve => worker.once('message', resolve))));
  const cpuStart = process.cpuUsage();
  const recovery = setTimeout(() => workers.forEach(worker => worker.terminate()), 45 * 60 * 1000);
  const command = `pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose${serial ? ' --maxWorkers=1' : ''}`;
  const log = fs.createWriteStream(path.join(output, name + '.log.txt'));
  log.write(JSON.stringify({command, node: process.version, cpus: os.availableParallelism(), loadThreads: 3, start: new Date(start).toISOString()})+'\n');
  console.log('START', name, command);
  let code;
  try {
    code = await new Promise((resolve,reject) => {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe']});
      child.stdout.pipe(log, {end:false}); child.stderr.pipe(log, {end:false});
      child.on('error',reject); child.on('close',resolve);
    });
  } finally {
    clearTimeout(recovery);
    await Promise.all(workers.map(worker => worker.terminate()));
    await new Promise(resolve => log.end(resolve));
  }
  const coverage = path.join(root, 'apps/web/coverage/coverage-summary.json');
  if (code === 0 && fs.existsSync(coverage)) fs.copyFileSync(coverage,path.join(output,name+'-coverage.json'));
  const cpu = process.cpuUsage(cpuStart);
  const result = {name,code,wallSeconds:(Date.now()-start)/1000,loadCpuSeconds:(cpu.user+cpu.system)/1e6,end:new Date().toISOString()};
  results.push(result); fs.writeFileSync(path.join(output,'verified-matrix-results.json'),JSON.stringify(results,null,2));
  console.log('RESULT',JSON.stringify(result));
}
(async()=>{for(const [name,serial] of [['verified-parallel-1',false],['verified-parallel-2',false],['verified-serial',true]]) await run(name,serial);})().catch(error => {console.error(error);process.exitCode=1;});
