const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const cp = require('node:child_process');
const original = cp.spawnSync;
cp.spawnSync = function (command, args, options) {
  if (!Array.isArray(args) || !args.includes('--max-old-space-size=128') || !args.includes('-e')) return original.apply(this, arguments);
  const started = process.hrtime.bigint();
  const out = original.apply(this, arguments);
  const data = {command,args:args.slice(0,-1),sourceHash:createHash('sha256').update(args.at(-1)).digest('hex'),options:{cwd:options.cwd,timeout:options.timeout,windowsHide:options.windowsHide,encoding:options.encoding},elapsedMs:Number(process.hrtime.bigint()-started)/1e6,pid:out.pid,status:out.status,signal:out.signal,error:out.error ? {name:out.error.name,message:out.error.message,code:out.error.code,errno:out.error.errno,syscall:out.error.syscall}:null,stdout:out.stdout,stderr:out.stderr};
  fs.writeFileSync(path.join(__dirname,process.env.GG486_DIAG_LABEL+'-child.json'), JSON.stringify(data,null,2)+'\n');
  return out;
};
require('node:module').syncBuiltinESMExports();
