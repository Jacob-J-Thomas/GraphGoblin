import {writeFileSync} from 'node:fs';
writeFileSync(process.env.GG_QA_ARGV_FILE,JSON.stringify({argv:process.argv,envKeys:Object.keys(process.env).sort()},null,2));
process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'synthetic-sdk-argv-thread'})+'\n');
process.stdout.write(JSON.stringify({type:'turn.started'})+'\n');
process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}})+'\n');
process.exit(0);
