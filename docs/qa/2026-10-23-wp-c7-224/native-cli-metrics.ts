import { createServer } from 'node:net';
import { createApiProcessFixture } from '../../../apps/api/src/testing/api-subprocess.js';
const f=await createApiProcessFixture({prefix:'gg-wp-c7-',portStart:5760,portCount:10});
const measure=async (step:string,run:()=>Promise<unknown>)=>{const start=Date.now();const result=await run();console.log(JSON.stringify({step,ms:Date.now()-start,...(typeof result==='object'?result:{})}));};
try {
 await measure('create key',async()=>{await f.createKey();});
 await measure('key usage',()=>f.run(['--create-api-key']).waitForExit());
 await measure('invalid key config',()=>f.run(['--create-api-key','invalid config'],{GG_PORT:'invalid'}).waitForExit());
 await measure('invalid preflight config',()=>f.run(['--preflight','--create-api-key'],{GG_PORT:'invalid'}).waitForExit());
 const server=createServer();await new Promise<void>(ok=>server.listen(f.port,'127.0.0.1',ok));
 try {await measure('occupied port startup cleanup',()=>f.run().waitForExit());}
 finally {await new Promise<void>(ok=>server.close(()=>ok()));}
} finally {await f.dispose();}
