// Inspect the recorded child event after the child loop was explicitly deleted.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {startServer,client,setCapacity,ADEQUATE,temp,join,root,here,Evidence} from './qa-lib.mjs';
const ev=new Evidence('14b-missing-child-detail');const base=join(temp,'gg-qa-412f-a-ui3'),capacityFile=join(base,'capacity.json');setCapacity(capacityFile,ADEQUATE);
const server=await startServer({dataDir:join(base,'data'),port:6620,capacityFile,logFile:join(base,'server.log.txt'),env:{QA_LOG_LEVEL:'warn'}});const api=client(server.url);
const {chromium}=createRequire(join(root,'apps/web/package.json'))('@playwright/test');const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const p=await browser.newPage();p.setDefaultTimeout(20000);const ids=(await api.listAll(5)).flat();ev.check('one surviving parent run in fixture',ids.length===1,ids);
 await p.goto(server.url+'/app/runs/'+ids[0]);const timeline=p.getByRole('list',{name:'Timeline',exact:true});
 await timeline.getByRole('button').filter({hasText:'child_run.started'}).click();
 const message=p.getByText(/Child run .* is no longer available\. Its loop may have been deleted\./);
 await message.waitFor();
 ev.log('selected child event detail',await message.innerText());
 ev.check('missing child is explicitly explained in inspector',await message.isVisible());
 await p.screenshot({path:join(here,'ui-parent-missing-child-detail.png'),fullPage:true});
}catch(e){ev.log('ERROR',String(e.stack??e));process.exitCode=1;}finally{await browser.close();ev.log('stop',await server.stop());ev.log('failures',ev.failures??0);}
