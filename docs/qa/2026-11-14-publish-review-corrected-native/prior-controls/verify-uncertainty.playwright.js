async (page) => {
  const setup = new URL(page.url());
  const origin = setup.origin;
  const variant = setup.searchParams.get('qa-variant');
  const wait = {timeout:10000};
  const requests = [], checkpoints = [], pageErrors = [];
  let step = 'initialize';
  let failure = null, finding = null, routePattern, handler, id;
  let phase = 'setup', heldVerifyRead;
  const deferred = () => {
    let resolve;
    const promise = new Promise((done)=>{ resolve=done; });
    return {promise,resolve};
  };
  const canonical = (value) => JSON.stringify(value, (key,item) => item && typeof item === 'object' &&
    !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key)=>[key,item[key]])) : item);
  const check = (condition, reason) => { if (!condition) throw new Error(reason); };
  const same = (actual, expected, reason) => check(canonical(actual)===canonical(expected),
    reason+'\nExpected '+canonical(expected)+'\nActual '+canonical(actual));
  const sleep = (ms) => new Promise((done)=>setTimeout(done,ms));
  const frozenBundle = setup.searchParams.get('qa-bundle');
  const seenBundle = [];
  page.on('pageerror',(error)=>pageErrors.push(String(error)));
  page.on('response',(response)=>{
    if (new URL(response.url()).pathname===frozenBundle) seenBundle.push(response.status());
  });
  const publish = () => page.getByRole('button',{name:'Publish',exact:true});
  const notice = (title) => page.getByText(title,{exact:true});
  const settle = async () => {
    await page.getByRole('button',{name:'Publishing…',exact:true}).waitFor({state:'hidden',...wait});
    await publish().waitFor(wait);
  };
  async function http(method,path,status,body) {
    const response = await page.request.fetch(origin+path,{method,timeout:10000,
      ...(body===undefined ? {} : {data:body})});
    const result = await response.json();
    same(response.status(),status,method+' '+path+' '+canonical(result));
    return result;
  }
  const detail = () => http('GET','/loops/'+id,200);
  const versions = () => http('GET','/loops/'+id+'/versions',200);
  const getVersion = (versionId) => http('GET','/loops/'+id+'/versions/'+versionId,200);
  async function readDevice() {
    return page.evaluate((key)=>new Promise((done)=>{
      const open = indexedDB.open('graphgoblin');
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => done(null);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const result = db.transaction('drafts').objectStore('drafts').get(key);
          result.onerror = () => { db.close(); done(null); };
          result.onsuccess = () => { db.close(); done(result.result??null); };
        } catch { db.close(); done(null); }
      };
    }),id);
  }
  const snapshot = (label) => page.evaluate((label)=>({
    label,path:location.pathname,save:document.querySelector('[data-testid="save-state"]')?.textContent??null,
    messages:[...document.querySelectorAll('[role="alert"],[role="status"]')]
      .filter((el)=>el.getClientRects().length).map((el)=>el.textContent.trim()),
  }),label);
  const picture = (tag) => page.screenshot({
    path:(variant === 'not-admitted' ? 'not-admitted' : 'committed')+'-'+tag+'.png',animations:'disabled',
  });
  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    check(['committed','not-admitted'].includes(variant),'Select an explicit real admission order');
    check(/^\/app\/assets\/index-[\w-]+\.js$/.test(frozenBundle??''),'Provide the verified served bundle path for the frozen candidate');
    check(setup.searchParams.get('qa-profile')==='237-corrected-independent-v1','Bind the frozen notice profile before execution');
    const pid = setup.searchParams.get('qa-pid');
    check(/^[0-9]+$/.test(pid??''),'Expected owned gateway pid');
    same((await page.request.get(origin+'/healthz')).headers()['x-graphgoblin-pid'],pid,'Exact disposable gateway');
    const name = 'Unknown-outcome refusal '+variant+' '+crypto.randomUUID().slice(0,8);
    const definition = {
      schemaVersion:4,name,description:'Immutable known intended graph',
      variables:{key:{type:'string'}},
      nodes:[
        {id:'start',kind:'trigger',label:'Start',config:{type:'manual'},ui:{x:0,y:80}},
        {id:'done',kind:'exit',label:'Finish',config:{returns:'"exact graph after one admission"'},ui:{x:310,y:80}},
      ],
      edges:[{id:'start-done',from:{node:'start',port:'out'},to:{node:'done',port:'in'}}],
    };
    id = (await http('POST','/loops',201,{definition})).loop.id;
    const p = '/loops/'+id, post = p+'/publish', draft = p+'/draft';
    const initial = await detail();
    const beforeHistory = await versions();
    same(beforeHistory.items.filter(({status})=>status==='published').length,0,'Start as publishable draft only');

    routePattern = (url) => [p,post,draft].includes(url.pathname) && url.origin===origin;
    handler = async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      const row = {phase,method,path:pathname,at:Date.now()};
      requests.push(row);
      if (row.phase==='ambiguous' && pathname===post && method==='POST') {
        if (variant==='committed') {
          const upstream = await route.fetch({maxRetries:0});
          row.upstreamStatus = upstream.status();
          row.body = await upstream.json();
          row.delivery = 'aborted after actual upstream commit';
        } else {
          row.delivery = 'aborted before reaching upstream';
        }
        await route.abort('failed');
      } else if (['ambiguous','failed-precheck'].includes(row.phase) && pathname===p && method==='GET') {
        row.delivery = 'aborted before reaching upstream (readback or refresh)';
        await route.abort('failed');
      } else {
        const upstream = await route.fetch({maxRetries:0});
        row.upstreamStatus = upstream.status();
        if (pathname===post || (pathname===p && row.phase==='retry')) row.body = await upstream.json();
        if (heldVerifyRead && !heldVerifyRead.used && row.phase==='retry' && pathname===p && method==='GET') {
          heldVerifyRead.used = true;
          const lease = heldVerifyRead;
          row.delivery = 'held after true detail GET';
          lease.arrival.resolve(row);
          await lease.release.promise;
          await route.fulfill({response:upstream});
          row.delivery = 'released true detail GET';
          row.deliveredAt = Date.now();
          lease.done.resolve(row);
        } else {
          row.delivery = 'actual gateway response';
          await route.fulfill({response:upstream});
          row.deliveredAt = Date.now();
        }
      }
    };
    await page.route(routePattern,handler);
    await page.goto(origin+'/app'+p+'/edit');
    await page.getByRole('heading',{name,exact:true}).waitFor(wait);
    await page.getByText('The editor is available. Checking the server and this device before saving changes.',{exact:true})
      .waitFor({state:'hidden',...wait});
    const settings = page.getByRole('button',{name:'Show loop settings',exact:true});
    if (await settings.isVisible()) await settings.click();
    const variable = page.locator('.cm-content').and(page.getByLabel('Variables value 1',{exact:true}));
    await variable.waitFor(wait);
    const validText = await variable.textContent();
    const initialDevice = await readDevice();

    step = 'lose publication response in '+variant+' variant and fail readback';
    phase = 'ambiguous';
    await publish().click();
    await notice('Publish not confirmed').waitFor(wait);
    await settle();
    await page.getByText(/Publish again checks the server first/).waitFor(wait);
    const afterFirst = await detail();
    const firstPost = requests.filter((item)=>item.phase==='ambiguous' && item.path===post);
    same(firstPost.length,1,'Exactly one first browser POST');
    if (variant==='committed') {
      same(firstPost[0].upstreamStatus,200,'First POST genuinely committed');
      same(afterFirst.current,firstPost[0].body.version,'Authoritative current version is the lost response version');
      same(afterFirst.current.definition,initial.draft.definition,'Committed the accepted definition');
      same(afterFirst.draft,undefined,'First admission consumed the draft');
      same(await getVersion(afterFirst.current.id),afterFirst.current,'First immutable version readback');
    } else {
      same(firstPost[0].upstreamStatus,undefined,'First POST had no upstream response');
      same(afterFirst,initial,'Aborted first POST left the accepted draft and no publication');
    }
    check(requests.some((row)=>row.phase==='ambiguous'&&row.path===p&&row.delivery.startsWith('aborted')),
      'First direct readback did not fail');
    checkpoints.push({step, initial, initialDevice, afterFirst, ui:await snapshot(step)});
    await picture('01-unknown');

    step = 'refuse deliberate Publish while native Variables input is invalid';
    // Keep any background refresh failed until the refusal, so none can establish readback success.
    await variable.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('[');
    same(await variable.textContent(),'['+validText,'Native form holds malformed JSON');
    const discard = page.getByRole('button',{name:'Discard the unparsed text',exact:true});
    await discard.waitFor(wait);
    const prior = requests.length;
    await publish().click();
    await notice('Publish failed').waitFor(wait);
    await page.getByText(/Some fields hold input that is not a valid value yet/).waitFor(wait);
    await settle();
    await sleep(700);
    const refusedWire = requests.slice(prior).filter(({path})=>[p,post,draft].includes(path));
    same(refusedWire,[],'Locally refused click sent no detail GET, draft PUT or publish POST');
    same(await detail(),afterFirst,'Local refusal changed no public record');
    same(await readDevice(),initialDevice,'Refused local buffer changed no device definition entry');
    checkpoints.push({step,typed:await variable.textContent(),device:await readDevice(),ui:await snapshot(step),refusedWire});
    await picture('02-local-refusal');

    step = 'discard held text while preserving the full previously accepted graph';
    phase = 'discard';
    await discard.click();
    await discard.waitFor({state:'hidden',...wait});
    same(await variable.textContent(),validText,'Discard restored exact visible Variables source');
    await settle();
    await sleep(700);
    const beforeRetry = await detail();
    same(beforeRetry,afterFirst,'Discard did not change acknowledged definition, token or current version');
    same(requests.filter(({phase,method})=>phase==='discard' && method!=='GET'),[],'Discard performed no write');
    checkpoints.push({step,beforeRetry,device:await readDevice(),ui:await snapshot(step)});

    if (variant==='not-admitted') {
      step = 'one repeated explicit readback failure retains uncertainty';
      phase = 'failed-precheck';
      await publish().click();
      await settle();
      const attempts = requests.filter((row)=>row.phase===phase);
      checkpoints.push({step,attempts,server:await detail(),ui:await snapshot(step)});
      same(attempts[0]?.method,'GET','Failed fresh attempt must begin with a readback');
      same(attempts.filter(({method})=>method==='POST' || method==='PUT'),[],
        'Failed repeated readback must not write');
      await page.getByText(/Checking the server before publishing again failed/).waitFor(wait);
      same(await detail(),beforeRetry,'Second failed check left exact server state');
    }

    step = 'fresh explicit Publish after discarding the held buffer';
    phase = 'retry';
    const first = requests.length;
    heldVerifyRead = {used:false,arrival:deferred(),release:deferred(),done:deferred()};
    await publish().click();
    const witness = await Promise.race([
      heldVerifyRead.arrival.promise,
      (async()=>{
        const deadline=Date.now()+10000;
        while (!heldVerifyRead.used && Date.now()<deadline) {
          const firstPost = requests.slice(first).find(({method,path})=>method==='POST'&&path===post);
          if (firstPost && !heldVerifyRead.used) return {unexpected:firstPost};
          await sleep(35);
        }
        const delay = deadline-Date.now();
        if (delay>0) await sleep(delay);
        return {timeout:true};
      })(),
    ]);
    if (witness.unexpected) {
      finding = { type:'PRECHECK_LOST_AFTER_LOCAL_REFUSAL', firstRetry:witness.unexpected };
      checkpoints.push({step,wire:requests.slice(first),finding});
      throw new Error('Retry started a publication before readback');
    }
    check(!witness.timeout,'Fresh explicit action had no independently observed detail readback');
    same(witness.upstreamStatus,200,'Readback reached real gateway before any POST');
    same(witness.body,beforeRetry,'Held true readback contains the exact earlier committed/untouched state');
    same(requests.slice(first).map(({method,path})=>[method,path]),[['GET',p]],
      'No replacement save or publish may precede/reach the held precheck');
    checkpoints.push({step,heldReadback:structuredClone(witness),ui:await snapshot(step)});
    heldVerifyRead.release.resolve();
    const delivered = await Promise.race([heldVerifyRead.done.promise,sleep(10000).then(()=>null)]);
    check(delivered,'The real held detail response did not reach the browser');
    await settle();
    await sleep(300);
    const retry = requests.slice(first).filter(({path})=>[p,post,draft].includes(path));
    const after = await detail();
    const history = await versions();
    same(await getVersion(after.current.id),after.current,'Final immutable publication readback');
    same(history.items.filter(({status})=>status==='published'),[after.current],'Only one immutable publication exists');
    same(after.current.version,1,'Exactly version 1');
    same(after.current.definition,initial.draft.definition,'Version preserved the exact acknowledged definition');
    same(retry.filter(({method})=>method==='PUT'),[],'Retry did not replace the accepted definition');
    const retryPosts = retry.filter(({method,path})=>method==='POST'&&path===post);
    const readBeforePost = retry[0]?.method==='GET' && retry[0]?.path===p && retry[0]?.upstreamStatus===200;
    check(readBeforePost,'Fresh Publish did not perform a successful detail readback first');
    if (variant==='committed') {
      same(after,beforeRetry,'Clean discard/retry preserves exact accepted publication');
      same(retryPosts,[],'Confirmed equivalent immutable publication must not send another POST');
      await page.getByText(/Nothing to publish: version 1 already holds this draft/).waitFor(wait);
    } else {
      same(retryPosts.length,1,'A genuinely unadmitted first request allows one fresh POST');
      same(retryPosts[0].upstreamStatus,200,'The one post-readback admission succeeded');
      same(retryPosts[0].body.version,after.current,'Fresh admission returns this exact immutable graph');
      await page.getByText(/Published version 1\./).waitFor(wait);
    }
    checkpoints.push({step,retry,after,history,device:await readDevice(),ui:await snapshot(step),finding});
    await picture('03-fresh-retry');
    same(seenBundle,[200],'Edge loaded exact independently bound app bundle');
    same(pageErrors,[],'Uncaught browser page errors');
  } catch (error) {
    failure = {step,message:String(error),stack:error.stack,ui:await snapshot(step).catch(()=>null)};
    await picture('first-attempt-failure').catch(()=>{});
  } finally {
    heldVerifyRead?.release.resolve();
    if (handler) await page.unroute(routePattern,handler).catch(()=>{});
  }
  return {suite:'237-corrected-uncertainty-independent-v1',variant,id,origin,seenBundle,requests,checkpoints,pageErrors,finding,failure};
}
