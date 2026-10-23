const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const root=process.cwd(),out=__dirname,scratch=path.join(out,'scratch'),results=[];
const file='apps/web/src/forms/cron/control.tsx',test='apps/web/src/forms/cron/control.test.tsx';
const production=fs.readFileSync(path.join(root,file),'utf8'),changed=fs.readFileSync(path.join(root,test),'utf8');
async function run(name,pattern){const command=`pnpm.cmd --filter @graphgoblin/web exec vitest run --config ${path.join(out,'scratch.config.mjs')} src/forms/cron/control.test.tsx --reporter=verbose${pattern?' -t "'+pattern+'"':''}`;const log=fs.createWriteStream(path.join(out,name+'.log.txt'));log.write(command+'\n');const start=Date.now();console.log('START',name);const code=await new Promise((resolve,reject)=>{const p=spawn(process.env.ComSpec,['/d','/s','/c',command],{cwd:root,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore','pipe','pipe']});p.stdout.pipe(log,{end:false});p.stderr.pipe(log,{end:false});p.on('error',reject);p.on('close',resolve);});await new Promise(resolve=>log.end(resolve));const result={name,code,wallSeconds:(Date.now()-start)/1000};results.push(result);fs.writeFileSync(path.join(out,'status-probe.json'),JSON.stringify(results,null,2));console.log('RESULT',JSON.stringify(result));}
async function main(){try{
 const start=production.indexOf('  const announcement ='),end=production.indexOf('  return { query, enabled, valid: requestable, announcement };',start);
 if(start<0||end<0)throw new Error('Missing announcement boundary');
 const separate=`  const [announced, setAnnounced] = useState(settled);\n  useEffect(() => {\n    const timer = setTimeout(() => setAnnounced({ expression, timezone, summary, valid: requestable }), 0);\n    return () => clearTimeout(timer);\n  }, [expression, timezone, summary, requestable]);\n`;
 const mutant=production.slice(0,start)+separate+production.slice(start,end).replaceAll('settled.','announced.')+production.slice(end);
 fs.writeFileSync(path.join(scratch,file),mutant);
 fs.writeFileSync(path.join(out,'status-mutation.patch.txt'),separate+production.slice(start,end).replaceAll('settled.','announced.'));
 await run('status-premature-all-changed');
 fs.writeFileSync(path.join(scratch,test),execFileSync('git',['show','39705dd7e961cf64e48cf7c66275774ec2b5e958:'+test],{cwd:root,encoding:'utf8'}));
 await run('status-premature-original','announces debounced values');
 const stronger=changed.replace("      fireEvent.change(raw(), { target: { value: 'broken' } });", "      await act(() => vi.advanceTimersByTimeAsync(349));\n      expect(status.textContent).toBe(before);\n      fireEvent.change(raw(), { target: { value: 'broken' } });");
 fs.writeFileSync(path.join(scratch,test),stronger);
 await run('status-premature-strengthened','announces debounced values');
 fs.writeFileSync(path.join(scratch,file),production);
 await run('status-normal-strengthened','announces debounced values');
}finally{fs.writeFileSync(path.join(scratch,file),production);fs.writeFileSync(path.join(scratch,test),changed);}}
main().catch(error=>{console.error(error);process.exitCode=1;});
