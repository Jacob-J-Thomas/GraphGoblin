import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
export const adequate={mode:'fixed',totalBytes:100*1024**3,availableBytes:50*1024**3};
export const pressure={mode:'fixed',totalBytes:100*1024**3,availableBytes:0.5*1024**3};
export const control=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
export async function start(name,port,file) {
  const dir=path.join(L.ROOT,name);fs.mkdirSync(dir,{recursive:true});
  return L.startApi(name,port,{},undefined,{stdin:true,args:[path.join(L.RECORD,'capacity-server.mjs'),dir,String(port),file]});
}
