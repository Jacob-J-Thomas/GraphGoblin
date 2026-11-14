async (page) => {
  const origin = new URL(page.url()).origin;
  const id = page.url().split('/').at(-2);
  const dialog = page.getByRole('dialog');
  const rows = [];
  const errors = [];
  const puts = [];
  page.on('request', (r)=>{if(r.method()==='PUT') puts.push({url:r.url(),body:r.postDataJSON()});});
  async function current() {
    const response=await page.request.get(origin+'/loops/'+id);
    return ((await response.json()).draft.definition.nodes.find((n)=>n.id==='subject')).config;
  }
  async function visible() {
    const timeout=dialog.getByRole('spinbutton',{name:'Timeout seconds',exact:true});
    const seconds=dialog.getByRole('spinbutton',{name:'Seconds',exact:true});
    return {
      mode:await dialog.getByRole('combobox',{name:'Mode',exact:true}).evaluate((e)=>e.selectedOptions[0]?.textContent),
      timeout:await timeout.count()?await timeout.inputValue():null,
      seconds:await seconds.count()?await seconds.inputValue():null,
      onTimeout:await dialog.getByRole('radiogroup',{name:'On timeout'}).locator('input:checked').evaluateAll((n)=>n.map((e)=>e.value)),
    };
  }
  async function saveWhen(expected) {
    for(let n=0;n<100;n++){
      const saved=await current();
      if(Object.entries(expected).every(([k,v])=>saved[k]===v)) return saved;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return await current();
  }
  async function choose(label){
    await dialog.getByRole('combobox',{name:'Mode',exact:true}).selectOption({label});
  }
  rows.push({step:'before',visible:await visible(),saved:await current()});
  await choose('duration');
  rows.push({step:'duration immediately after switch',visible:await visible()});
  await dialog.getByRole('spinbutton',{name:'Seconds',exact:true}).fill('13');
  await dialog.getByRole('spinbutton',{name:'Seconds',exact:true}).press('Tab');
  rows.push({step:'duration payload',visible:await visible(),saved:await saveWhen({mode:'duration',seconds:13})});
  await dialog.getByRole('spinbutton',{name:'Timeout seconds',exact:true}).fill('59');
  await dialog.getByRole('spinbutton',{name:'Timeout seconds',exact:true}).press('Tab');
  rows.push({step:'duration explicit same-named timeout',visible:await visible(),saved:await saveWhen({mode:'duration',timeoutSeconds:59})});
  await choose('signal');
  rows.push({step:'signal immediately after second switch',visible:await visible()});
  const name=dialog.getByRole('textbox',{name:'Name',exact:true});
  await name.fill('i08-signal');
  await name.press('Tab');
  rows.push({step:'signal payload',visible:await visible(),saved:await saveWhen({mode:'signal',name:'i08-signal'})});
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await page.getByTestId('node-subject').locator(':scope > div:has([data-kind])').click();
  rows.push({step:'signal after reload',visible:await visible(),saved:await current()});
  await page.screenshot({path:'union-wait-after.png'});
  return {id,rows,puts,errors};
}
