import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const run=promisify(execFile);
const exe=process.env.SystemRoot+'/System32/WindowsPowerShell/v1.0/powershell.exe';
const command=`$ErrorActionPreference='Stop'; $owner=Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.pid}'; if ($null -ne $owner.CreationDate) { $owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) }`;
for(let n=0;n<3;n++) {const start=Date.now();try{const r=await run(exe,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:20000,maxBuffer:1024}); console.log(JSON.stringify({trial:n+1,ms:Date.now()-start,stdout:r.stdout.trim(),stderr:r.stderr}));}catch(e){console.log(JSON.stringify({trial:n+1,ms:Date.now()-start,code:e.code,killed:e.killed,message:e.message}));}}
