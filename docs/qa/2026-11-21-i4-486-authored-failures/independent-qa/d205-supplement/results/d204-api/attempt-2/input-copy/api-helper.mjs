import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import net from 'node:net';
import {ROOT,imp,testing,assert,sleep} from './common.mjs';
const api=await imp('apps/api/dist/index.js');
const {createApiKey}=await imp('apps/api/dist/create-api-key.js');
export const portRefuses=(port)=>new Promise(resolve=>{const c=net.connect({host:'127.0.0.1',port});c.once('connect',()=>{c.destroy();resolve(false);});c.once('error',e=>resolve(e.code==='ECONNREFUSED'));});
export async function boot({port=5871,dataDir,keys}){
 assert.ok(![4747,4748,11434].includes(port));assert.equal(await portRefuses(port),true);mkdirSync(dataDir,{recursive:true});
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(GG_|JEV_)/i.test(k)));
 Object.assign(env,{GG_DATA_DIR:dataDir,GG_HOST:'127.0.0.1',GG_PORT:String(port),GG_REQUIRE_API_KEY:'true',GG_WEB_DIST:join(ROOT,'apps/web/dist'),GG_GOBLIN_DIST:'',GG_LOG_LEVEL:'silent',GG_OLLAMA_ENABLED:'false',GG_OLLAMA_URL:'http://127.0.0.1:5879',GG_SWAGGER_UI:'false',GG_SHUTDOWN_GRACE_MS:'10000'});
 const config=api.loadConfig(env);keys??={admin:(await createApiKey(config,{label:'D205 disposable admin',scopes:['*']})).token};
 const logger=new testing.CapturingLogger();const harness=new testing.FakeHarness([], 'codex');const claude=new testing.FakeHarness([], 'claude');
 const container=await api.createContainer(config,{logger,harnesses:{codex:harness,claude},startTimers:false});
 const workspaceCalls=[];const workspace=container.ports.workspace;container.ports.workspace=new Proxy(workspace,{get(target,prop){const value=target[prop];if(typeof value!=='function')return value;return (...args)=>{if(prop==='resolve'||prop==='writeFile')workspaceCalls.push({method:prop,args:structuredClone(args),at:new Date().toISOString()});return value.apply(target,args);};}});
 await container.start();const app=await api.buildApp(container);await app.listen({host:'127.0.0.1',port});const base=`http://127.0.0.1:${port}`;
 async function rest(method,path,body,key=keys.admin){const response=await fetch(base+path,{method,headers:{...(key?{authorization:`Bearer ${key}`} :{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await response.text();let json;try{json=JSON.parse(text);}catch{}return {status:response.status,json,text};}
 async function publish(def){const created=await rest('POST','/loops',{definition:def});assert.equal(created.status,201,JSON.stringify(created.json));const loopId=created.json.loop.id;const published=await rest('POST',`/loops/${loopId}/publish`);assert.equal(published.status,200,JSON.stringify(published.json));return {loopId,version:published.json,created};}
 async function settle(id){const start=Date.now();while(Date.now()-start<15000){await container.manager.waitForIdle();const res=await rest('GET',`/runs/${id}`);if(['failed','succeeded','cancelled','exhausted','waiting'].includes(res.json?.status))return res.json;await sleep(20);}throw new Error(`settle timeout ${id}`);}
 async function run(loopId,input){const response=await rest('POST',`/loops/${loopId}/runs`,input===undefined?{}:{input});assert.equal(response.status,202,JSON.stringify(response.json));return await settle(response.json.run.id);}
 async function events(id){const response=await rest('GET',`/runs/${id}/events?limit=500`);assert.equal(response.status,200);assert.equal(response.json.hasMore,false);return response.json.items;}
 async function shutdown(){const response=await rest('POST','/system/shutdown',{action:'drain'});await Promise.race([container.waitForShutdown(),sleep(12000).then(()=>{throw new Error('drain timeout');})]);await app.close();await container.dispose();const refused=await portRefuses(port);assert.equal(response.status,202);assert.equal(refused,true);return {status:response.status,port,refused,pid:process.pid};}
 return {container,harness,logger,workspaceCalls,rest,publish,run,settle,events,shutdown,keys,dataDir,port,base};
}
