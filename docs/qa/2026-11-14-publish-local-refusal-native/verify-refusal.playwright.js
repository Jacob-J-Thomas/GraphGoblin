async (page) => {
  const origin = new URL(page.url()).origin;
  const wait = {timeout:10000};
  const requests = [], checkpoints = [], pageErrors = [];
  let step = 'initialize';
  let failure = null, finding = null, routePattern, handler, id;
  let phase = 'setup';
  const canonical = (value) => JSON.stringify(value, (key,item) => item && typeof item === 'object' &&
    !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key)=>[key,item[key]])) : item);
  const check = (condition, reason) => { if (!condition) throw new Error(reason); };
  const same = (actual, expected, reason) => check(canonical(actual)===canonical(expected),
    reason+'\nExpected '+canonical(expected)+'\nActual '+canonical(actual));
  const sleep = (ms) => new Promise((done)=>setTimeout(done,ms));
  const frozenBundle = '/app/assets/index-DK8I-ydH.js';
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
  const picture = (tag) => page.screenshot({path:tag+'.png',animations:'disabled'});
  try {
    check(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) && !/:474[78]$/.test(origin),'Refused owner or nonfixture origin');
    const pid = new URL(page.url()).searchParams.get('qa-pid');
    check(/^[0-9]+$/.test(pid??''),'Expected owned gateway pid');
    same((await page.request.get(origin+'/healthz')).headers()['x-graphgoblin-pid'],pid,'Exact disposable gateway');
    const name = 'Unknown-outcome refusal '+crypto.randomUUID().slice(0,8);
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
      if (phase==='ambiguous' && pathname===post && method==='POST') {
        const upstream = await route.fetch({maxRetries:0});
        row.upstreamStatus = upstream.status();
        row.body = await upstream.json();
        row.delivery = 'aborted after actual upstream commit';
        await route.abort('failed');
      } else if (phase==='ambiguous' && pathname===p && method==='GET') {
        row.delivery = 'aborted without upstream (readback or background refresh)';
        await route.abort('failed');
      } else {
        const upstream = await route.fetch({maxRetries:0});
        row.upstreamStatus = upstream.status();
        if (pathname===post || (pathname===p && phase==='retry')) row.body = await upstream.json();
        row.delivery = 'actual gateway response';
        await route.fulfill({response:upstream});
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

    step = 'lose response to a real committed publication and fail readback';
    phase = 'ambiguous';
    await publish().click();
    await notice('Publish not confirmed').waitFor(wait);
    await settle();
    await page.getByText(/Publish again checks the server first/).waitFor(wait);
    const committed = await detail();
    const firstPost = requests.filter((item)=>item.phase==='ambiguous' && item.path===post);
    same(firstPost.length,1,'Exactly one first browser POST');
    same(firstPost[0].upstreamStatus,200,'First POST genuinely committed');
    same(committed.current,firstPost[0].body.version,'Authoritative current version is the lost response version');
    same(committed.current.definition,initial.draft.definition,'Committed the accepted definition');
    same(committed.draft,undefined,'First admission consumed the draft');
    same(await getVersion(committed.current.id),committed.current,'First immutable version readback');
    check(requests.some((row)=>row.phase==='ambiguous'&&row.path===p&&row.delivery.startsWith('aborted')),
      'First direct readback did not fail');
    checkpoints.push({step, initial, initialDevice, committed, ui:await snapshot(step)});
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
    same(await detail(),committed,'Local refusal changed no public record');
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
    same(beforeRetry,committed,'Discard did not change acknowledged definition, token or current version');
    same(requests.filter(({phase,method})=>phase==='discard' && method!=='GET'),[],'Discard performed no write');
    checkpoints.push({step,beforeRetry,device:await readDevice(),ui:await snapshot(step)});

    step = 'fresh explicit Publish after discarding the held buffer';
    phase = 'retry';
    const first = requests.length;
    await publish().click();
    await settle();
    await sleep(300);
    const retry = requests.slice(first).filter(({path})=>[p,post,draft].includes(path));
    const after = await detail();
    const history = await versions();
    same(await getVersion(committed.current.id),committed.current,'First publication remains immutable');
    same(after,beforeRetry,'Clean discard/retry preserves exact accepted publication');
    same(history.items.filter(({status})=>status==='published'),[committed.current],'Only one immutable publication exists');
    same(retry.filter(({method})=>method==='PUT'),[],'Retry did not replace the accepted definition');
    const retryPosts = retry.filter(({method,path})=>method==='POST'&&path===post);
    const retryReads = retry.filter(({method,path})=>method==='GET'&&path===p);
    const readBeforePost = retry[0]?.method==='GET' && retry[0]?.path===p && retry[0]?.upstreamStatus===200;
    if (!readBeforePost && retryPosts.length) {
      finding = {type:'PRECHECK_LOST_AFTER_LOCAL_REFUSAL',
        firstRetryMethod:retry[0].method,firstRetryPath:retry[0].path,browserRetryPosts:retryPosts.length,
        browserRetryPostStatuses:retryPosts.map(({upstreamStatus})=>upstreamStatus),lateReads:retryReads.length};
    } else {
      check(readBeforePost,'Fresh Publish did not perform a successful detail readback');
      same(retryPosts,[],'Confirmed equivalent immutable publication must not send another POST');
    }
    checkpoints.push({step,retry,after,history,device:await readDevice(),ui:await snapshot(step),finding});
    await picture('03-fresh-retry');
    same(seenBundle,[200],'Edge loaded exact independently bound app bundle');
    same(pageErrors,[],'Uncaught browser page errors');
  } catch (error) {
    failure = {step,message:String(error),stack:error.stack,ui:await snapshot(step).catch(()=>null)};
    await picture('first-attempt-failure').catch(()=>{});
  } finally {
    if (handler) await page.unroute(routePattern,handler).catch(()=>{});
  }
  return {suite:'237-9e44-held-refusal-diagnostic-v1',id,origin,seenBundle,requests,checkpoints,pageErrors,finding,failure};
}
