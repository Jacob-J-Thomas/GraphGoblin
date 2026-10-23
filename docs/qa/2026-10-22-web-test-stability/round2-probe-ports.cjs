const net=require('node:net');
(async()=>{
  const ports=await Promise.all(Array.from({length:10},(_,i)=>5770+i).map(port=>new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    let done=false;
    const finish=result=>{if(done)return;done=true;socket.destroy();resolve({host:'127.0.0.1',port,...result});};
    socket.on('connect',()=>finish({listening:true}));
    socket.on('error',error=>finish({listening:false,error:error.code}));
    socket.setTimeout(1000,()=>finish({unknown:true,error:'TIMEOUT'}));
  })));
  console.log(JSON.stringify({ports},null,2));
  if(ports.some(p=>p.listening||p.unknown||p.error!=='ECONNREFUSED'))process.exitCode=1;
})();
