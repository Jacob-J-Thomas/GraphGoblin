import os from 'node:os';
console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,os:os.version(),logicalCpus:os.availableParallelism(),totalMemory:os.totalmem(),freeMemory:os.freemem()}, null, 2));
for (const url of ['http://127.0.0.1:6170/healthz']) {
  const response = await fetch(url);
  console.log(JSON.stringify({url,status:response.status,body:await response.json()}));
}
