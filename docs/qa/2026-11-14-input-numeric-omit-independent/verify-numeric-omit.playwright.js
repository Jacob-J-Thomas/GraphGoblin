async (page) => {
  const origin = new URL(page.url()).origin;
  const stats = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    viewport: [innerWidth, innerHeight],
    browser: navigator.userAgent,
  }));
  const label = stats.coarse ? 'touch' : 'desktop';
  const observations = [];
  const posts = [];
  const pageErrors = [];
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  function canon(value) {
    return JSON.stringify(value, (_, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
        : item,
    );
  }
  const equal = (observed, expected, context) =>
    assert(canon(observed) === canon(expected),
      context + ' expected ' + canon(expected) + ', observed ' + canon(observed));
  async function api(method, path, data) {
    const reply = await page.request.fetch(origin + path, { method, ...(data===undefined?{}:{data}) });
    assert(reply.ok(), method+' '+path+' '+reply.status()+' '+await reply.text());
    return reply.json();
  }
  const waitForPost = (path) => page.waitForResponse((reply) =>
    reply.request().method()==='POST' && new URL(reply.url()).pathname===path);
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method()==='POST' && /^\/(?:loops\/[^/]+\/runs|runs\/[^/]+\/input)$/.test(path))
      posts.push({ path, body:request.postDataJSON() });
  });
  const numeric = async (locator) => locator.evaluate((input) => {
    const form = input.closest('form');
    const errorIds = new Set((input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    const messages = [...errorIds].map((id)=>document.getElementById(id)?.textContent ?? '').filter(Boolean);
    return {
      value: input.value, number: Number.isFinite(input.valueAsNumber)?input.valueAsNumber:null,
      badInput:input.validity.badInput, valid:input.validity.valid, formValid:form.checkValidity(),
      focused:input===document.activeElement, invalid:input.getAttribute('aria-invalid'), messages,
      type:input.type,
    };
  });
  const dropPath = (stage, phase) => label+'-'+stage+'-'+phase+'.png';
  let active = 'fixture setup';
  try {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/:474[78]$/.test(origin),'Unexpected fixture origin');
    const schema = {
      type:'object', additionalProperties:false, required:['requiredCount'],
      properties:{
        count:{type:'number',title:'Optional count'},
        requiredCount:{type:'number',title:'Required count'},
        stable:{type:'integer',title:'Keep zero'},
        note:{type:'string',title:'Keep text'},
        absent:{type:'string',title:'Untouched optional'},
      },
    };
    const definition = {
      schemaVersion:4, name:'Independent numeric omission '+label,
      nodes:[
        { id:'begin',kind:'trigger',label:'Begin',config:{type:'manual',inputSchema:schema} },
        { id:'answer',kind:'wait',label:'Answer',config:{mode:'input',prompt:'Supply fixture values',inputSchema:schema} },
        { id:'done',kind:'exit',label:'Done',config:{returns:'{"start": trigger.payload, "answer": lastOutput.value}'} },
      ],
      edges:[
        {id:'to-answer',from:{node:'begin',port:'out'},to:{node:'answer'}},
        {id:'to-done',from:{node:'answer',port:'out'},to:{node:'done'}},
      ],
    };
    const {loop}=await api('POST','/loops',{definition});
    const base='/loops/'+loop.id;
    const {version}=await api('POST',base+'/publish');
    await page.addInitScript((theme)=>localStorage.setItem('graphgoblin-theme',theme),stats.coarse?'dark':'light');
    await page.goto(origin+'/app/runs/new?loop='+loop.id);

    async function exercise(stage, submitLabel, expected) {
      const form=page.getByRole('form',{name:submitLabel,exact:true});
      await form.waitFor();
      const submit=form.getByRole('button',{name:submitLabel,exact:true});
      const optional=form.getByRole('spinbutton',{name:'Optional count',exact:true});
      const required=form.getByRole('spinbutton',{name:'Required count',exact:true});
      const zero=form.getByRole('spinbutton',{name:'Keep zero',exact:true});
      const text=form.getByRole('textbox',{name:'Keep text',exact:true});
      const omit=form.getByRole('button',{name:'Omit Optional count',exact:true});
      const requiredOmit=form.getByRole('button',{name:'Omit Required count',exact:true});
      const steps={stage,snapshots:[],initialOmit:await omit.count()};
      observations.push(steps);
      const firstPost=posts.length;
      assert(steps.initialOmit===0,'Untouched optional unexpectedly offers Omit');
      await text.fill(expected.note);
      await zero.fill('0');
      // Required control remains ineligible for omission and refuses native incomplete input.
      await required.press('-');
      assert((await numeric(required)).badInput,'Required input did not expose native incomplete number');
      await submit.click();
      const blocked=await numeric(required);
      assert(blocked.badInput && blocked.invalid==='true','Required native error disappeared before correction');
      assert(await requiredOmit.count()===0,'Required number offers Omit');
      equal(posts.length,firstPost,'Required invalid input sent a POST');
      steps.requiredAfterRefusal=blocked;
      await required.fill(String(expected.requiredCount));

      let omitGeometryChecked=false;
      for(const keys of [['-'],['1','e']]) {
        await optional.clear();
        for(const key of keys) await optional.press(key);
        const typed=await numeric(optional);
        if(keys.length>1 && !typed.badInput){
          steps.snapshots.push({sequence:keys.join(''),nativeBadInputExposed:false,typed});
          if(typed.value!=='' || await omit.count()) {
            await omit.click();
            assert(!(await numeric(optional)).badInput,'Exponent fallback did not reset');
          }
          continue;
        }
        assert(typed.badInput && typed.value==='' && !typed.valid,'Incomplete number did not expose browser badInput');
        await submit.click();
        const rejected=await numeric(optional);
        assert(rejected.invalid==='true' && rejected.badInput,'Expected accessible validation for incomplete optional');
        assert(rejected.messages.some(message=>/number/i.test(message)), 'Missing number validation message');
        equal(posts.length,firstPost,'Incomplete optional input sent a POST');
        await omit.waitFor();
        if(keys.length===1) {
          await optional.scrollIntoViewIfNeeded();
          await page.screenshot({path:dropPath(stage,'before-omit'),animations:'disabled'});
        }
        if(stats.coarse && !omitGeometryChecked) {
          await omit.scrollIntoViewIfNeeded();
          const button=await omit.boundingBox(), input=await optional.boundingBox();
          const gap=input.y-button.y-button.height;
          assert(button.width>=44 && button.height>=44 && gap>0,'Coarse Omit geometry regressed');
          const inField=[button.x+button.width/2,input.y+2];
          assert(inField[0]>input.x && inField[0]<input.x+input.width,'Touch control setup missed the field');
          await page.touchscreen.tap(...inField);
          assert((await numeric(optional)).badInput,'Tap inside field unexpectedly erased the edit');
          assert(await omit.count()===1,'Tap inside field triggered Omit');
          steps.geometry={width:button.width,height:button.height,gap,oneRealTap:inField};
          omitGeometryChecked=true;
        }
        if(stats.coarse && keys.length===1) {
          const box=await omit.boundingBox();
          await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        } else if(keys.length===1) {
          await optional.press('Shift+Tab');
          assert(await omit.evaluate((button)=>document.activeElement===button),'Keyboard missed Omit');
          await page.keyboard.press('Enter');
        } else {
          await omit.click();
        }
        const after=await numeric(optional);
        steps.snapshots.push({sequence:keys.join(''),typed,rejected,after});
        if(keys.length===1) await page.screenshot({path:dropPath(stage,'after-omit'),animations:'disabled'});
        assert(after.value==='' && !after.badInput && after.valid && after.formValid,
          'Native incomplete number remained after Omit: '+canon(after));
        assert(after.focused && after.invalid!=='true' && !after.messages.some(s=>/enter a number/i.test(s)),
          'Omit did not remove accessible error or restore focus: '+canon(after));
        assert(await omit.count()===0,'Omitted field still offers Omit');
        equal(await zero.inputValue(),'0','Sibling zero was altered');
        equal(await text.inputValue(),expected.note,'Sibling text was altered');
      }
      equal(await required.inputValue(),String(expected.requiredCount),'Required numeric edit changed');
      return submit;
    }

    active='New Run';
    const startBody={requiredCount:3,stable:0,note:'retained Start '+label};
    const start=await exercise('start','Start run',startBody);
    const started=waitForPost(base+'/runs');
    await start.click();
    const startResponse=await started;
    assert(startResponse.status()===202,'Start failed');
    const {run}=await startResponse.json();
    equal(posts[0],{path:base+'/runs',body:{triggerNodeId:'begin',versionId:version.id,input:startBody}},'Start POST');
    await page.getByText('Input requested',{exact:true}).waitFor();
    const runPath='/runs/'+run.id;
    const parked=await api('GET',runPath);
    const threadBefore=await api('GET',runPath+'/thread');
    equal(threadBefore.invocation.trigger.payload,startBody,'Persisted Start input');

    active='Wait Input';
    const answerBody={requiredCount:5,stable:0,note:'retained Wait '+label};
    const submit=await exercise('wait','Submit input',answerBody);
    const submitted=waitForPost(runPath+'/input');
    await submit.click();
    assert((await submitted).status()===200,'Wait answer failed');
    equal(posts[1],{path:runPath+'/input',body:{waitId:parked.waiting.waitId,input:answerBody}},'Wait POST');
    equal(posts.length,2,'Issue exactly one valid POST per form');
    await page.locator('[data-status="succeeded"]').first().waitFor();
    const terminal=await api('GET',runPath);
    const thread=await api('GET',runPath+'/thread');
    const events=await api('GET',runPath+'/events');
    const answers=events.items.filter(({type})=>type==='input.received');
    equal(answers.map(({payload})=>payload),[answerBody],'Persisted input event');
    equal(thread.invocation.trigger.payload,startBody,'Final persisted Start');
    equal(thread.outputs.answer.value,answerBody,'Final persisted Wait');
    equal(terminal.result,{start:startBody,answer:answerBody},'Final published run result');
    equal(pageErrors,[],'Browser page errors');
    return {label,stats,observations,posts,runId:run.id,versionId:version.id,
      persisted:{threadStart:thread.invocation.trigger.payload,threadAnswer:thread.outputs.answer.value,
        waitEvent:answers[0],result:terminal.result},pageErrors,failure:null};
  } catch(error) {
    await page.screenshot({path:label+'-failure.png',animations:'disabled'}).catch(()=>undefined);
    return {label,stats,observations,posts,pageErrors,failure:{active,message:String(error),stack:error.stack}};
  }
}
