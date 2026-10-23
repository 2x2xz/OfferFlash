import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
import type {BrowserWindow} from 'electron';
import type {AppEvent} from '../../packages/shared/src/contracts.js';

/** Production renderer + real isolated page containers. The two artificial
 * receipts below test display isolation only, never enterprise fill quality. */
export async function smokeBrowserTabsUI(window:BrowserWindow,methods:Record<string,(...args:any[])=>Promise<any>>,send:(event:AppEvent)=>void,directory:string){
 if(!process.argv.includes('--smoke-test')||!process.argv.includes('--smoke-browser-tabs-only')||window.isVisible())throw Error('ISOLATED_TABS_UI_REQUIRED');
 const ui=<T=any>(code:string)=>window.webContents.executeJavaScript(code) as Promise<T>;
 const until=async(code:string)=>{const limit=Date.now()+5000;while(!await ui<boolean>(code)){if(Date.now()>limit)throw Error('TABS_UI_TIMEOUT:'+code);await new Promise(resolve=>setTimeout(resolve,30));}};
 const finishReview=async()=>{await until('!!document.querySelector("[data-testid=agent-question-prompt]")?.textContent.includes("本轮填写已核对")');await ui('Array.from(document.querySelectorAll("[data-testid=agent-question-prompt] button")).find(button=>button.textContent.trim()==="暂时跳过").click()');await until('!document.querySelector("[data-testid=agent-question-prompt]")');};
 const checks:string[]=[];const check=(value:unknown,name:string)=>{if(!value)throw Error(name);checks.push(name);};
 const server=createServer((request,response)=>{response.setHeader('content-type','text/html;charset=utf-8');response.end(`<!doctype html><title>页面 ${request.url==='/a'?'A':'B'}</title><label>备注<input></label>`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');const origin=`http://127.0.0.1:${address.port}`;
 const originalModel=methods.modelStatus!,originalFill=methods.runUniversalFill!,originalSetup=methods.applicationSetup!;const calls:string[]=[];
 const model={mode:'live' as const,provider:'fixture-only',modelId:'display-receipt-only',configured:true};
 methods.modelStatus=async()=>model;
 // This checks tab receipt display with fictional results, independently of
 // the real encrypted setup flow. No setup is saved and no upload is selected.
 methods.applicationSetup=async()=>({...await originalSetup(),confirmedAt:'2026-01-01T00:00:00.000Z'});
 methods.runUniversalFill=async()=>{const browser=await methods.browserState!();calls.push(browser.activeTabId);const isA=browser.url.endsWith('/a');return{status:'partial',verified:isA?7:2,matchedConfirmed:isA?7:2,alreadyCorrect:0,pending:1,missingRecords:0,message:isA?'仅供布局检查：页面 A 回执':'仅供布局检查：页面 B 回执',modelRequests:0,modelTokens:0,remaining:[]};};
 try{
  await until('!!window.offer&&!!document.querySelector(".workbench")');await ui('document.querySelector("[data-testid=onboarding-skip]")?.click()');
  const config={mode:'live' as const,provider:'custom',modelId:'connection-fixture',apiKey:'invalid-test-key-only',baseURL:'https://connection-fixture.invalid/v1',remember:true};
  const connected=await methods.configureModel!(config);check(connected.remembered&&connected.canReuseKey&&!JSON.stringify(connected).includes(config.apiKey),'model-configuration-public-status-has-no-key');
  const reused=await methods.configureModel!({...config,apiKey:'',reuseKey:true});check(reused.remembered,'same-endpoint-reuses-host-key');
  let rejected=false;try{await methods.configureModel!({...config,apiKey:'',reuseKey:true,baseURL:'https://other-fixture.invalid/v1'});}catch{rejected=true;}check(rejected&&(await originalModel()).modelId===config.modelId,'changed-endpoint-requires-key-and-preserves-connection');
  send({type:'navigate',page:'apply'});
  await until('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="模型设置")');
  await ui('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="模型设置").click()');
  await until('!!document.querySelector("[data-testid=model-api-key]")');
  check(await ui('document.querySelector("[data-testid=model-api-key]").value===""&&document.querySelector("[data-testid=model-api-key]").placeholder.includes("留空")'),'saved-key-never-echoes-in-model-dialog');
  check(await ui('!document.querySelector("[data-testid=model-apply]").disabled'),'saved-key-can-be-applied-with-empty-password');
  await ui('document.querySelector("[data-testid=model-forget]").click()');await until('!document.querySelector("[data-testid=model-forget]")');
  check(!(await originalModel()).remembered&&(await originalModel()).canReuseKey,'forget-removes-ciphertext-keeps-current-connection');
  await ui('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="取消").click()');
  await methods.configureModel!({mode:'demo',provider:'',modelId:'',apiKey:''});
  send({type:'model',status:model});send({type:'navigate',page:'browser'});
  await methods.browserNavigate!(origin+'/a');await until('document.querySelectorAll("[data-testid=application-browser-tabs] [role=tab]").length===1');
  const a=(await methods.browserState!()).activeTabId;
  await until('document.querySelector("[data-testid=quick-fill]")?.disabled===false');await ui('document.querySelector("[data-testid=quick-fill]").click()');
  await until('!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")');check(calls.length===1,'first-tab-shows-own-result');await finishReview();
  await until('document.querySelector("[data-testid=browser-new-tab]")?.disabled===false');await ui('document.querySelector("[data-testid=browser-new-tab]").click()');await until('document.querySelectorAll("[data-testid=application-browser-tabs] [role=tab]").length===2');
  check(await ui('!!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")'),'blank-tab-does-not-show-other-result');
  await ui(`(()=>{const input=document.querySelector('input[aria-label="网页地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(origin+'/b')});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();})()`);
  await until('Array.from(document.querySelectorAll("[role=tab]")).some(tab=>tab.textContent.includes("页面 B"))');
  const b=(await methods.browserState!()).activeTabId;check(a!==b&&(await methods.browserState!()).tabs.length===2,'address-bar-navigates-only-new-tab');
  await until('document.querySelector("[data-testid=quick-fill]")?.disabled===false');await ui('document.querySelector("[data-testid=quick-fill]").click()');await until('!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 B 回执")');await finishReview();
  await ui(`document.querySelector('[data-testid="browser-tab-${a}"]').click()`);await until('!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")');check(await ui('!!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 B 回执")'),'returning-tab-restores-own-result');
  await methods.browserNewTab!(origin+'/a');await until('document.querySelectorAll("[data-testid=application-browser-tabs] [role=tab]").length===3');check(await ui('!!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")'),'same-url-tab-keeps-distinct-result-state');
  await methods.browserSelectTab!(a);await until('!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")');
  window.setSize(1080,800);await new Promise(resolve=>setTimeout(resolve,80));
  const geometry=await ui<{overflow:boolean;tabBottom:number;pageTop:number;closeButtons:number}>(`(()=>{const strip=document.querySelector('[data-testid=application-browser-tabs]'),page=document.querySelector('.browser-placeholder');return{overflow:document.documentElement.scrollWidth>innerWidth,tabBottom:strip.getBoundingClientRect().bottom,pageTop:page.getBoundingClientRect().top,closeButtons:strip.querySelectorAll('.application-browser-tab-close').length};})()`);
  check(!geometry.overflow&&geometry.pageTop>=geometry.tabBottom&&geometry.closeButtons===3,'narrow-layout-keeps-tabs-above-native-page');
  await writeFile(join(directory,'browser-tabs-narrow.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(1480,980);await new Promise(resolve=>setTimeout(resolve,80));await writeFile(join(directory,'browser-tabs-wide.png'),(await window.webContents.capturePage()).toPNG());
  await ui(`document.querySelector('[data-testid="browser-tab-${b}"]').parentElement.querySelector('.application-browser-tab-close').click()`);await until('document.querySelectorAll("[data-testid=application-browser-tabs] [role=tab]").length===2');check(await ui('!!document.querySelector("[data-testid=universal-fill-result] .universal-result-report")?.textContent.includes("页面 A 回执")'),'closing-other-tab-keeps-current-result');
  check(calls.length===2,'tab-switches-do-not-restart-agent');
  await methods.browserReload!();await until('!document.querySelector("[data-testid=universal-fill-result]")');check(calls.length===2,'reload-invalidates-receipt-without-rerunning-agent');
  const report={browserTabsUICheck:true,ok:true,checks,fixtureReceiptsOnly:true,realEnterpriseFillScore:false,modelRequests:0,normalUserDataAccessed:false};await writeFile(join(directory,'browser-tabs-ui.json'),JSON.stringify(report,null,2));return report;
 }catch(error){await writeFile(join(directory,'browser-tabs-ui-error.txt'),String(error)+'\n'+JSON.stringify({calls})+'\n'+await ui('document.body.innerText'));await writeFile(join(directory,'browser-tabs-ui-error.png'),(await window.webContents.capturePage()).toPNG());throw error;}finally{methods.modelStatus=originalModel;methods.runUniversalFill=originalFill;methods.applicationSetup=originalSetup;server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}
