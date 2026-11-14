async (page) => {
 const origin = new URL(page.url()).origin;
 const model=await page.request.put(origin+'/classifier-models/i08-fixture',{data:{displayName:'Fixture only',providerModel:'fixture',endpoint:'http://127.0.0.1:9',provider:'http',primitives:['choice','noul','score']}});
 if(!model.ok()) throw Error(await model.text());
 const enabled=await page.request.patch(origin+'/classifier-models/i08-fixture',{data:{enabled:true}});
 if(!enabled.ok()) throw Error(await enabled.text());
 const head = {id:'start',kind:'trigger',label:'Start',config:{type:'manual'},ui:{x:0,y:100}};
 const via = {id:'via',kind:'mutate',label:'Via',config:{operations:[{op:'append-message',role:'note',content:'fixture'}]},ui:{x:760,y:370}};
 const tail = {id:'done',kind:'exit',label:'Done',config:{},ui:{x:1010,y:100}};
 const repeat={id:'return-again',label:'Again',repeat:true};
 const finish={id:'finish',label:'Finish'};
 const configs = {
  llm:{kind:'llm',harness:'codex',instructions:'Choose finish',model:{mode:'inherit'},effort:{mode:'inherit'},routes:[repeat,finish],maxPasses:2},
  choice:{kind:'classifier',model:'i08-fixture',question:'Pick',answer:{type:'choice',options:[{...repeat,criteria:'repeat'}, {...finish,criteria:'finish'},{id:'third',label:'Third',criteria:'third'}]},maxPasses:3},
  noul:{kind:'classifier',model:'i08-fixture',question:'Pick',answer:{type:'noul',true:{...repeat,criteria:'repeat'},false:{...finish,criteria:'finish'}},maxPasses:3},
  score:{kind:'classifier',model:'i08-fixture',question:'Pick',answer:{type:'score',anchors:['low','high'],bands:[{id:'low',label:'Low',min:0,max:.4},{id:'high',label:'High',min:.4,max:1}]}},
 };
 const fixtures = {};
 for(const [kind,config] of Object.entries(configs)){
  const definition={schemaVersion:4,name:'I08 baseline output '+kind,nodes:[head,{id:'subject',kind:'decision',label:'Subject',config,ui:{x:325,y:100}},via,tail],edges:[{id:'one',from:{node:'start',port:'out'},to:{node:'subject'}},{id:'two',from:{node:'via',port:'out'},to:{node:'done'}}]};
  const response=await page.request.post(origin+'/loops',{data:{definition}});
  const body=await response.json();
  if(response.ok()) fixtures[kind]=body.loop.id;
  else fixtures[kind]={status:response.status(),body};
 }
 return fixtures;
}

