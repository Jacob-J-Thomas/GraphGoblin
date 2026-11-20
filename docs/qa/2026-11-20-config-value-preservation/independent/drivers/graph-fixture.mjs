export const BAD_KEY='gg_qa/slash';
export const GOOD_KEY='features.multi_agent';
export const RULE='Codex config overrides require every key segment to use letters, digits, "_" or "-", and not __proto__, constructor or prototype.';
export function fixture(){return{
 schemaVersion:4,name:'Config and editor integration QA',description:'Synthetic inert override-key correction with unrelated existing edge geometry.',settings:{workingDirectory:{kind:'temp'}},
 nodes:[
  {id:'start',kind:'trigger',label:'Start',config:{type:'manual'},ui:{x:0,y:180}},
  {id:'pick',kind:'decision',label:'Pick',config:{kind:'expression',jsonata:'"yes"',routes:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]},ui:{x:280,y:180}},
  {id:'work',kind:'inference',label:'Work',config:{harness:'codex',session:{policy:'fresh'},prompt:{template:'Inert QA fixture. Never run.'},harnessOptions:{sandbox:'read-only',approval:'never',configOverrides:{'features.plugins':false,'gg_qa.notes':'kept'}},timeoutSeconds:120},ui:{x:570,y:40}},
  {id:'done',kind:'exit',label:'Done',config:{},ui:{x:920,y:40}},
  {id:'other',kind:'exit',label:'Other',config:{},ui:{x:920,y:460}},
 ],
 edges:[
  {id:'start-edge',from:{node:'start',port:'out'},to:{node:'pick',port:'in'},ui:{route:[220]}},
  {id:'work-edge',from:{node:'pick',port:'yes'},to:{node:'work',port:'in'},ui:{route:[500,100,550]}},
  {id:'done-edge',from:{node:'work',port:'out'},to:{node:'done',port:'in'},ui:{route:[850]}},
  {id:'neighbor-edge',from:{node:'pick',port:'no'},to:{node:'other',port:'in'},ui:{route:[700,520,860]}},
 ],
};}
