import {app,BrowserWindow,WebContentsView,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {runUniversalFormAgent} from '../../packages/agent/src/universal-form-agent.js';
import {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import {overrideProfile as profile} from './override-profile.js';

const directory=await mkdtemp(resolve('.backups/universal-budget-ipc-'));app.setPath('userData',directory);
const phases:Array<{phase:string;ms:number}>=[],start=performance.now();const mark=(phase:string)=>{const value={phase,ms:performance.now()-start};phases.push(value);appendFileSync(join(directory,'phases.jsonl'),JSON.stringify(value)+'\n');};
await app.whenReady();let requests=0,busy=false;
const server=createServer(async(request,response)=>{for await(const _chunk of request){/* Drain fixture request without logging contents. */}requests++;response.writeHead(200,{'content-type':'text/event-stream'});const common={id:'local-'+requests,object:'chat.completion.chunk',created:1,model:'local-budget-fixture'};response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'inspect-'+requests,type:'function',function:{name:'inspect_application',arguments:'{}'}}]},finish_reason:null}]})+'\n\n');response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})+'\n\n');response.end('data: [DONE]\n\n');});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
const provider=await BackgroundModelProvider.create({mode:'live',provider:'custom',modelId:'local-budget-fixture',apiKey:'fictional-local-only',baseURL:`http://127.0.0.1:${address.port}/v1`},2500,'universal');
const preload=join(directory,'preload.cjs');await writeFile(preload,"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('settlement',{run:()=>ipcRenderer.invoke('fictional-budget-settlement')});");
const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}}),view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'universal-budget-fictional'}});window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:900,height:700});
const controller=new AbortController();const watchdog=setTimeout(()=>{mark('watchdog');controller.abort();},15000);
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<label>姓名<input id="name"></label><label>邮箱<input id="email" type="email"></label><script>window.inputWrites=0;document.addEventListener("input",()=>window.inputWrites++);</script>'));
 await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<div id="status" data-busy="false">Fictional settlement regression</div>'));
 ipcMain.handle('fictional-budget-settlement',async()=>{
  assert.equal(busy,false);busy=true;mark('ipc-enter');
  try{const bridge=await attachPlaywrightView(view.webContents);mark('bridge-attached');try{
   const result=await runUniversalFormAgent({page:bridge.page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:controller.signal,provider,directory:join(directory,'runtime'),taskId:'ipc-budget-fixture',onEvent:event=>{if(['task_error','sdk_settled','task_settled'].includes(event.type))mark(event.type);}});mark('agent-returned');return result;
  }finally{mark('bridge-close-start');await bridge.close();mark('bridge-close-returned');}}
  finally{busy=false;mark('host-busy-false');}
 });
 const result=await window.webContents.executeJavaScript(`(async()=>{const status=document.getElementById('status');status.dataset.busy='true';try{return await window.settlement.run();}finally{status.dataset.busy='false';}})()`);mark('renderer-receipt');
 assert.equal(result.status,'failed');assert.equal(result.modelRequests,20);assert.equal(requests,20);assert.equal(result.modelTokens,240);assert.equal(result.verified,0);assert.equal(busy,false);
 const rendererBusy=await window.webContents.executeJavaScript("document.getElementById('status').dataset.busy==='true'");const inputWrites=await view.webContents.executeJavaScript('window.inputWrites');assert.equal(rendererBusy,false);assert.equal(inputWrites,0);assert.ok(phases.some(phase=>phase.phase==='sdk_settled'));
 const report={universalBudgetSettlement:true,ok:true,status:result.status,requests,modelTokens:result.modelTokens,hostBusy:busy,rendererBusy,bridgeDetached:!view.webContents.debugger.isAttached(),inputWrites,phases,paidRequests:0,externalRequests:0};await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 clearTimeout(watchdog);ipcMain.removeHandler('fictional-budget-settlement');provider.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));view.webContents.close();window.destroy();app.exit(0);
}catch(error){mark('fixture-error');console.error(error);clearTimeout(watchdog);provider.close();server.closeAllConnections();server.close();window.destroy();app.exit(1);}
