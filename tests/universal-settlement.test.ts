import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {Type} from 'typebox';
import {BackgroundModelProvider} from '../packages/agent/src/background-model-provider.js';
import {createOfferAgentRuntime} from '../packages/runtime/src/runtime.js';

const bounded=async<T>(work:Promise<T>,label:string,ms=5000)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(Error('SETTLEMENT_TIMEOUT:'+label)),ms);})]);}finally{clearTimeout(timer);}};

test('production provider synchronous 20-request budget error settles the real Pi session and runtime close',async()=>{
 const directory=await mkdtemp(resolve('.backups/runtime-budget-settlement-'));let requests=0,tools=0;
 const server=createServer(async(request,response)=>{
  for await(const _chunk of request){/* Only drain the fictional local request. */}requests++;
  response.writeHead(200,{'content-type':'text/event-stream'});
  const common={id:'local-'+requests,object:'chat.completion.chunk',created:1,model:'local-budget-fixture'};
  response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'inspect-'+requests,type:'function',function:{name:'inspect_probe',arguments:'{}'}}]},finish_reason:null}]})+'\n\n');
  response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})+'\n\n');response.end('data: [DONE]\n\n');
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
 const provider=await BackgroundModelProvider.create({mode:'live',provider:'custom',apiKey:'fictional-local-only',modelId:'local-budget-fixture',baseURL:`http://127.0.0.1:${address.port}/v1`},2500,'universal');
 const runtime=await createOfferAgentRuntime({stateDir:directory,modelRuntime:provider.runtime,model:provider.model,tools:[{name:'inspect_probe',label:'Read fictional probe',description:'A read-only fictional fixture.',parameters:Type.Object({},{additionalProperties:false}),async execute(){tools++;return{content:[{type:'text',text:'{"fixture":true,"needsNextRead":true}'}],details:{fixture:true}};}}]});
 try{
  const start=performance.now(),result=await bounded(provider.withTaskLimit('budget-fixture',20,()=>runtime.run('Read the fictional probe repeatedly.')),'runtime.run');
  const runMs=performance.now()-start;assert.equal(result.status,'failed');assert.equal(requests,20);assert.equal(tools,20);assert.equal(provider.attempts.length,20);
  assert.ok(result.events.some(event=>event.type==='task_error'&&String(event.data.message).includes('BACKGROUND_MODEL_BUDGET_OR_CREDENTIAL_STOP')));
  assert.ok(result.events.some(event=>event.type==='sdk_settled'));assert.equal(result.events.at(-1)?.type,'task_settled');
  const closeStart=performance.now();await bounded(runtime.close(),'runtime.close');const report={runtimeBudgetSettlement:true,ok:true,requests,tools,status:result.status,runMs,closeMs:performance.now()-closeStart,paidRequests:0,externalRequests:0};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
 }finally{await bounded(runtime.close(),'final close').catch(()=>{});provider.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

test('hidden production universal Agent returns its IPC receipt and releases busy state after decision budget error',async()=>{
 const directory=await mkdtemp(resolve('.backups/universal-settlement-test-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/universal-settlement-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);const timer=setTimeout(()=>{child.kill('SIGTERM');void writeFile(join(directory,'output.log'),output);reject(Error('Hidden settlement timeout\n'+output));},25000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)),reject);});});
 const line=output.split('\n').find(line=>line.includes('"universalBudgetSettlement":true'));assert.ok(line,output);const report=JSON.parse(line);
 assert.equal(report.ok,true);assert.equal(report.requests,2);assert.equal(report.status,'failed');assert.equal(report.hostBusy,false);assert.equal(report.rendererBusy,false);assert.equal(report.bridgeDetached,true);assert.equal(report.inputWrites,2);assert.equal(report.paidRequests,0);assert.equal(report.externalRequests,0);
});
