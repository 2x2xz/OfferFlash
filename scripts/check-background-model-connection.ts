import {readBenchmarkCredential} from '../packages/evaluation/src/credential-input.js';
import {BackgroundModelProvider} from '../packages/agent/src/background-model-provider.js';
process.stdout.write('DEDICATED_KEY_STDIN_READY\n');
let key=await readBenchmarkCredential(process.stdin,{timeoutMs:600000});
const provider=await BackgroundModelProvider.create({mode:'live',provider:'custom',modelId:'qwen-flash',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:key},1);key='';
try{await provider.withTask('connection-only-not-benchmark',()=>provider.runtime.completeSimple(provider.model,{systemPrompt:'仅回复READY。',messages:[{role:'user',content:'连接检查，不计入Agent测评。',timestamp:Date.now()}],tools:[]},{maxTokens:12,maxRetries:0}));
  await new Promise(r=>setImmediate(r));console.log(JSON.stringify({scope:'connection-only-not-benchmark',attempts:provider.attempts}));
}catch{console.log(JSON.stringify({scope:'connection-only-not-benchmark',status:'failed',attempts:provider.attempts}));}
finally{provider.close();}
