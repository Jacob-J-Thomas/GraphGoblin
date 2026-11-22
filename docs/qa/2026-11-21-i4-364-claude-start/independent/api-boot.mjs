import { pathToFileURL } from 'node:url';
const {serve}=await import(pathToFileURL('G:/ggq/gg-i4-364-qa/GraphGoblin/apps/api/dist/serve.js'));
const {app}=await serve();
console.log(JSON.stringify({qaReady:true,pid:process.pid,address:app.server.address()}));
