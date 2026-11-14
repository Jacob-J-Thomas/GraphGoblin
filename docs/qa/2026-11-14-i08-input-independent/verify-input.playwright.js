async (page) => {
  const origin = new URL(page.url()).origin;
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const theme = coarse ? 'dark' : 'light';
  const label = coarse ? 'touch-dark' : 'desktop-light';
  const outcome = { label, coarse, posts: [], results: [], pageErrors: [] };
  const assert = (condition, text) => { if (!condition) throw new Error(text); };
  const canonical = (value) => JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]]))
      : v
  );
  const same = (observed, expected, context) => assert(canonical(observed) === canonical(expected),
    context + ' expected ' + canonical(expected) + ' observed ' + canonical(observed));
  const routeJson = async (method,path,payload) => {
    const response = await page.request.fetch(origin+path,{method,...(payload===undefined?{}:{data:payload})});
    assert(response.ok(),method+' '+path+' returned '+response.status()+': '+(await response.text()));
    return response.json();
  };
  page.on('pageerror', (error) => outcome.pageErrors.push(String(error)));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (/^\/loops\/[^/]+\/runs$|^\/runs\/[^/]+\/input$/).test(path))
      outcome.posts.push({path, body:request.postDataJSON()});
  });
  let form;
  try {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin), 'Unexpected fixture origin');
    const schema = {
      type:'object', additionalProperties:false, required:['approval'],
      properties: {
        approval:{type:'string', minLength:2, title:'Approval note'},
        prefix:{type:'string', title:'Untouched', default:'hint-only'},
        nullable:{type:'null', title:'Null marker'},
        text:{type:'string', title:'Explicit text'},
        keep:{type:'string', title:'Keep this text'},
        reset:{type:'string', title:'Reset this field'},
        qty:{type:'integer', title:'Count'},
        enabled:{type:'boolean', title:'Enabled'},
        mode:{enum:['','manual','scheduled'],title:'Execution mode'},
        otherMode:{enum:['','auto'],title:'Optional unused mode'},
      },
    };
    const definition = {
      schemaVersion:4, name:'Independent Input '+label,
      nodes:[
        {id:'begin',kind:'trigger',label:'Begin',config:{type:'manual',inputSchema:schema}},
        {id:'answer',kind:'wait',label:'Answer',config:{mode:'input',prompt:'Provide the fixture answer',inputSchema:schema}},
        {id:'done',kind:'exit',label:'Done',config:{returns:'{"receivedAtStart": trigger.payload, "receivedAtWait": lastOutput.value}'}},
      ],
      edges:[
        {id:'to-answer',from:{node:'begin',port:'out'},to:{node:'answer'}},
        {id:'to-done',from:{node:'answer',port:'out'},to:{node:'done'}},
      ],
    };
    const created = await routeJson('POST','/loops',{definition});
    const loopId = created.loop.id;
    const published = await routeJson('POST','/loops/'+loopId+'/publish');
    await page.addInitScript(t => localStorage.setItem('graphgoblin-theme',t),theme);
    await page.goto(origin+'/app/runs/new?loop='+loopId);

    const selected = (group, name) => group.getByRole('radio',{name,exact:true});
    const choose = async (group, name) => {
      await group.getByText(name,{exact:true}).click();
      assert(await selected(group,name).isChecked(),'Radio did not select '+name);
    };
    const isInvalid = async (control) => (await control.getAttribute('aria-invalid'))==='true';
    const waitInvalid = (id) => page.waitForFunction(
      (id) => document.getElementById(id)?.getAttribute('aria-invalid')==='true',id,
    );
    const focuses = (field) => field.evaluate(el => document.activeElement===el);
    const screenshot = async (stage, element) => {
      await element.scrollIntoViewIfNeeded();
      const width = await page.evaluate(() => ({ width:innerWidth, scroll:document.documentElement.scrollWidth }));
      assert(width.scroll <= width.width+1, 'Horizontal scroll at '+stage+': '+JSON.stringify(width));
      const path = label+'-'+stage+'.png';
      await page.screenshot({path, animations:'disabled'});
      return {path, width};
    };
    async function prepare(kind,target,omitWithTouch) {
      const buttonLabel = kind==='new'?'Start run':'Submit input';
      form = page.getByRole('form',{name:buttonLabel,exact:true});
      const button = form.getByRole('button',{name:buttonLabel,exact:true});
      const field = (name) => form.getByLabel(name,{exact:true});
      const group = (name) => form.getByRole('radiogroup',{name,exact:true});
      await form.waitFor();
      const beforePosts=outcome.posts.length;
      const approval=field('Approval note'), text=field('Explicit text'), nullable=field('Null marker');
      const qty=field('Count'), keep=field('Keep this text'), reset=field('Reset this field');
      const mode=group('Execution mode'), untouchedMode=group('Optional unused mode');
      const shape = { condition:await page.evaluate(() => ({coarse:matchMedia('(pointer: coarse)').matches, dark:matchMedia('(prefers-color-scheme: dark)').matches, ua:navigator.userAgent})), invalid:{}, taps:[] };
      assert(shape.condition.coarse===coarse && shape.condition.dark===coarse,'Fixture config not applied');
      assert(await selected(mode,'Not set').isChecked(),'Initial option is not absent');
      await choose(mode,'""');
      await choose(mode,'Not set');
      await choose(mode,'""');
      assert(await selected(untouchedMode,'Not set').isChecked(),'Unedited second enum changed');
      await text.fill('to clear');
      await text.clear();
      same(await text.inputValue(),'','Explicit text is cleared');
      same(await text.getAttribute('placeholder'),'""','Explicit state marker');
      const offset = (element) => element.evaluate(e=>e.getBoundingClientRect().top-e.closest('form').getBoundingClientRect().top);
      const restKeep = await offset(keep);
      const restReset = await offset(reset);
      await keep.fill(target.keep);
      await reset.fill('intentionally discard just this');
      same(await offset(keep),restKeep,'Revealing Omit did not move the edited field');
      same(await offset(reset),restReset,'Revealing Omit did not move the second edited field');
      await qty.press('-');
      shape.invalid.nativeBadNumber=await qty.evaluate(e=>e.validity.badInput);
      assert(shape.invalid.nativeBadNumber,'Number fixture failed to produce native badInput');
      await nullable.fill('  ');
      await button.click();
      for(const control of [approval,qty,nullable]){
        const id=await control.getAttribute('id');
        assert(id,'Missing field ID');
        await waitInvalid(id);
        assert(await isInvalid(control),'Expected invalid field '+id);
      }
      same(outcome.posts.length,beforePosts,'Invalid form did not issue POST');
      same(await form.getByRole('button',{name:'Omit Approval note',exact:true}).count(),0,'Required field has no omission action');
      const reachable = (element) => element.evaluate(e=> e.getBoundingClientRect().top-e.closest('form').getBoundingClientRect().top);
      const resetBefore=await reachable(reset);
      const resetAction=form.getByRole('button',{name:'Omit Reset this field',exact:true});
      const keepAction=form.getByRole('button',{name:'Omit Keep this text',exact:true});
      if (coarse) {
        await keep.scrollIntoViewIfNeeded();
        const b=await keep.boundingBox();
        const a=await keepAction.boundingBox();
        assert(b && a,'Touch target bounds unavailable');
        shape.touchedElement={ button:{ width:a.width,height:a.height },input:{width:b.width,height:b.height}, controlGap:b.y-a.y-a.height };
        assert(a.width>=44 && a.height>=44,'Coarse Omit target below 44 by 44: '+JSON.stringify(a));
        assert(shape.touchedElement.controlGap>=0,'Coarse Omit target overlaps field');
        const elementAtCenter=await keepAction.evaluate(e=>{const r=e.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;});
        assert(elementAtCenter,'Coarse Omit center not hittable');
        const targets=[
          [a.x+a.width/2,b.y+1],
          [Math.min(b.x+b.width-2,a.x+a.width-1),b.y+5],
          [b.x+b.width-2,b.y+12],
          [b.x+b.width/2,b.y+b.height/2],
        ];
        for(const [x,y] of targets){
          assert(x>b.x&&x<b.x+b.width&&y>b.y&&y<b.y+b.height,'Tap outside edited input: '+JSON.stringify({x,y,b,a}));
          await page.touchscreen.tap(x,y);
          const retained=await keep.inputValue();
          shape.taps.push({x,y,retained});
          same(retained,target.keep,'Touch must preserve field content');
        }
        const resetBox=await resetAction.boundingBox();
        assert(resetBox,'Missing own Omit target');
        await resetAction.scrollIntoViewIfNeeded();
        const visibleBox=await resetAction.boundingBox();
        await page.touchscreen.tap(visibleBox.x+visibleBox.width/2,visibleBox.y+visibleBox.height/2);
      } else {
        await reset.press('Shift+Tab');
        assert(await focuses(resetAction),'Shift+Tab failed to reach Omit');
        shape.focusBefore=await screenshot(kind+'-focus-omit',resetAction);
        await page.keyboard.press('Enter');
      }
      assert(await focuses(reset),'Omit did not return focus to its own input');
      same(await reachable(reset),resetBefore,'Omit did not move reset input vertically');
      same(await reset.inputValue(),'','Omitted control reset');
      same(await resetAction.count(),0,'Omit action disappeared with its value');
      same(await keep.inputValue(),target.keep,'Omitting one property left its neighbor intact');
      shape.focusAfter=await screenshot(kind+'-focus-returned',reset);
      await approval.fill(target.approval);
      await qty.fill('0');
      await nullable.fill('null');
      await choose(group('Enabled'),'No');
      return {button,shape,expected:target};
    }
    const fields = {text:'',nullable:null,qty:0,enabled:false,mode:''};
    const startInput={...fields,approval:'Start evidence',keep:'Start retained '+label};
    const waitInput={...fields,approval:'Wait evidence',keep:'Wait retained '+label};
    const start=await prepare('new',startInput,coarse);
    const started=page.waitForResponse(r => r.request().method()==='POST' && new URL(r.url()).pathname==='/loops/'+loopId+'/runs');
    await start.button.click();
    const startResponse=await started;
    same(startResponse.status(),202,'Start response');
    const admitted=await startResponse.json();
    const runId=admitted.run.id;
    same(outcome.posts[0],{path:'/loops/'+loopId+'/runs',body:{triggerNodeId:'begin',versionId:published.version.id,input:startInput}},'Exact start payload');
    await page.getByText('Input requested',{exact:true}).waitFor();
    const waiting=await routeJson('GET','/runs/'+runId);
    assert(waiting.status==='waiting'&&waiting.waiting.waitId,'Missing active wait');
    const checkpoint=await routeJson('GET','/runs/'+runId+'/thread');
    same(checkpoint.invocation.trigger.payload,startInput,'Persisted start payload before reply');
    const wait=await prepare('wait',waitInput,coarse);
    const waited=page.waitForResponse(r => r.request().method()==='POST' && new URL(r.url()).pathname==='/runs/'+runId+'/input');
    await wait.button.click();
    const reply=await waited;
    same(reply.status(),200,'Wait reply status');
    same(outcome.posts[1],{path:'/runs/'+runId+'/input',body:{waitId:waiting.waiting.waitId,input:waitInput}},'Exact wait input payload');
    same(outcome.posts.length,2,'Only explicit requests were submitted');
    await page.locator('[data-status="succeeded"]').first().waitFor();
    const snapshot=await routeJson('GET','/runs/'+runId);
    const thread=await routeJson('GET','/runs/'+runId+'/thread');
    const events=await routeJson('GET','/runs/'+runId+'/events');
    same(snapshot.result,{receivedAtStart:startInput,receivedAtWait:waitInput},'Run result');
    same(thread.invocation.trigger.payload,startInput,'Final persisted invocation payload');
    same(thread.outputs.answer.value,waitInput,'Final persisted answer node output');
    const received=events.items.filter(event=>event.type==='input.received');
    same(received.length,1,'Exactly one persisted input event');
    same(received[0].payload,waitInput,'Persisted input event body');
    same(outcome.pageErrors,[],'No browser page errors');
    outcome.results.push({loopId,runId,waitId:waiting.waiting.waitId,start:start.shape,wait:wait.shape,result:snapshot.result,
      invocationPayload:thread.invocation.trigger.payload,waitOutput:thread.outputs.answer.value,
      observedInputEvent:{type:received[0].type,seq:received[0].seq,nodeId:received[0].nodeId,payload:received[0].payload}});
  } catch(error) {
    outcome.failure={message:String(error),stack:error.stack,url:page.url()};
    try { await page.screenshot({path:label+'-first-failure.png',animations:'disabled'}); } catch {}
  }
  return outcome;
}
