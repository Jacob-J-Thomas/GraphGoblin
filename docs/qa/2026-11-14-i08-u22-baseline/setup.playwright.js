async (page) => {
  const origin = new URL(page.url()).origin;
  const fixtures = {};
  const cases = {};
  const trigger = {id:'start',kind:'trigger',label:'Start',config:{type:'manual'},ui:{x:0,y:130}};
  const note = {operations:[{op:'append-message',role:'note',content:'test-only'}]};
  const done = {id:'done',kind:'exit',label:'Done',config:{},ui:{x:1080,y:140}};
  const out = (id, source, port, target) => ({id,from:{node:source,port},to:{node:target}});
  const configNode = (kind,config) => ({ id:'subject',kind,label:'Subject',config,ui:{x:335,y:130} });
  const options = [{id:'again',label:'Try again',repeat:true},{id:'pass',label:'Pass'}];
  const binary = {type:'noul',true:{id:'true-result',label:'True result',criteria:'yes',repeat:true},false:{id:'false-result',label:'False result',criteria:'no'}};
  const choice = {type:'choice',options:[{id:'first-option',label:'First choice',criteria:'a',repeat:true},{id:'second-option',label:'Second choice',criteria:'b'},{id:'third-option',label:'Third choice',criteria:'c'}]};
  const score = {type:'score',anchors:['Low','High'],bands:[{id:'low-band',label:'Low band',min:0,max:0.5},{id:'high-band',label:'High band',min:0.5,max:1}]};
  const classifier = (answer, extra) => ({kind:'classifier',question:'Which result?',model:'qa-model',answer,...extra});
  const decisions = {
    expression:{kind:'expression',jsonata:'"pass"',routes:options,maxPasses:3},
    llm:{kind:'llm',instructions:'Choose pass',harness:'codex',routes:options,maxPasses:3},
    choice:classifier(choice,{maxPasses:3}),
    noul:classifier(binary,{maxPasses:3}),
    score:classifier(score,{}),
  };
  async function make(name,nodes,edges) {
    const response = await page.request.post(origin+'/loops',{data:{definition:{schemaVersion:4,name:'I08 baseline '+name,nodes,edges}}});
    cases[name] = {status:response.status()};
    if (!response.ok()) { cases[name].error=await response.json(); return; }
    const body = await response.json(); fixtures[name]=body.loop.id;
  }
  await make('union-wait',[trigger,configNode('wait',{mode:'input',prompt:'old variant prompt',timeoutSeconds:173,onTimeout:'fail-run'}),done],[out('one','start','out','subject'),out('two','subject','out','done')]);
  await make('union-mutate',[trigger,configNode('mutate',{operations:[{op:'set',path:'/vars/old-probe',value:{kind:'literal',value:'old literal'}}]}),done],[out('one','start','out','subject'),out('two','subject','out','done')]);
  await make('union-decision',[trigger,configNode('decision',decisions.expression),done],[out('one','start','out','subject')]);
  for (const [name,config] of Object.entries(decisions)) await make('output-'+name,[trigger,configNode('decision',config),{id:'via',kind:'mutate',label:'Via',config:note,ui:{x:740,y:340}},done],[out('one','start','out','subject'),out('two','via','out','done')]);
  const geometryNodes = [
    {...trigger,ui:{x:0,y:100}},
    {id:'side',kind:'mutate',label:'Side',config:note,ui:{x:320,y:100}},
    {id:'work',kind:'mutate',label:'Work',config:note,ui:{x:640,y:100}},
    {...configNode('decision',decisions.expression),ui:{x:960,y:100}},
    {...done,ui:{x:1260,y:100}},
    {id:'exhausted',kind:'exit',label:'Exhausted',config:{outcome:'exhausted'},ui:{x:1260,y:320}},
  ];
  for(const name of ['geometry','geometry-offline']) await make(name,geometryNodes,[out('start-work','start','out','work'),out('work-side','work','out','side'),out('side-decision','side','out','subject'),out('end','subject','pass','done'),out('limit','subject','limit-reached','exhausted'),out('return','subject','again','work')]);
  await page.goto(origin+'/app/loops/'+fixtures['union-wait']+'/edit');
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  return { fixtures,cases, userAgent:await page.evaluate(()=>navigator.userAgent) };
}
