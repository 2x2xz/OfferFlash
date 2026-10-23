import {app,BrowserWindow,WebContentsView} from 'electron';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {createOwnedSelectController} from '../../packages/browser/src/owned-select.js';
import {runUniversalFormAgent} from '../../packages/agent/src/universal-form-agent.js';
import {UniversalFormSession} from '../../packages/browser/src/universal-form.js';
import {overrideProfile} from './override-profile.js';
const directory=process.env.OFFERFLASH_ASYNC_OPTIONS_DIR!;if(!directory)throw Error('ISOLATED_DIRECTORY_REQUIRED');
app.setPath('userData',join(directory,'user-data'));await app.whenReady();
const html=(mode:string)=>'<meta charset="utf-8"><style>[role=listbox]{border:1px solid;padding:10px} [role=option]{padding:15px}</style><form onsubmit="window.submits++;return false"><fieldset><legend>教育经历</legend><label>学校名称<input id="school" aria-label="学校名称" role="combobox" aria-controls="menu" aria-valuetext="" onclick="menu.hidden=false;this.setAttribute(\'aria-expanded\',\'true\')" onkeydown="if(event.key===\'Escape\'){menu.hidden=true;this.setAttribute(\'aria-expanded\',\'false\')}"></label></fieldset><div id="menu" role="listbox" hidden></div><label><input id="consent" type="checkbox">真实性声明</label><button type="submit">提交申请</button></form><script>window.creates=0;window.submits=0;const mode='+JSON.stringify(mode)+';let timer;const empty=()=>{menu.innerHTML=\'<div>暂无选项</div><button type="button" onclick="window.creates++">添加学校全称</button>\'};empty();school.addEventListener("input",()=>{empty();clearTimeout(timer);if(mode==="unknown")return;timer=setTimeout(async()=>{menu.innerHTML="<div>加载中</div>";try{const r=await fetch("/query?mode="+mode);if(!r.ok)throw Error();const options=await r.json();empty();for(const value of options){const option=document.createElement("div");option.setAttribute("role","option");option.textContent=value;option.onclick=()=>{school.setAttribute("aria-valuetext",value);school.value="";school.setAttribute("aria-expanded","false");menu.hidden=true};menu.prepend(option)}}catch{menu.innerHTML="<div>加载失败</div>"}},600)});</script>';
const timers=new Set<ReturnType<typeof setTimeout>>();
const server=createServer((req,res)=>{const url=new URL(req.url!,'http://localhost');if(url.pathname!=='/query'){res.setHeader('content-type','text/html;charset=utf-8');res.end(html(url.searchParams.get('mode')??'delayed'));return;}const mode=url.searchParams.get('mode'),delay=mode==='delayed'?9000:mode==='pending'?30000:100;const timer=setTimeout(()=>{timers.delete(timer);res.writeHead(mode==='failed'?503:200,{'content-type':'application/json'});res.end(JSON.stringify(mode==='empty'?[]:['虚构异步大学']));},delay);timers.add(timer);});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{partition:'async-options-isolated',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:900,height:700});
let bridge:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;const report:any={kind:'real-browser-local-delayed-options-contract',paidRequests:0,externalWebsiteRequests:0,cases:{}};
try{
 await view.webContents.loadURL(origin+'/?mode=delayed');bridge=await attachPlaywrightView(view.webContents);const page=bridge.page;
 const listeners=()=>['request','response','requestfinished','requestfailed'].map(name=>(page as any).listenerCount(name));
 for(const mode of ['delayed','pending','failed','empty','unknown','cancel']){
  await page.goto(origin+'/?mode='+(mode==='cancel'?'pending':mode));const before=listeners(),control=new AbortController();
  const controller=await createOwnedSelectController(page.locator('#school'),async()=>{if(control.signal.aborted)throw Error('APPLICATION_CONTEXT_CHANGED:cancelled');},{label:'学校名称'});
  const started=Date.now();let snapshot:any,reason;
  try{const initial=await controller.open('虚构异步大学');assert.ok(initial.canCreate,'Fixture reproduces an early create footer');
   if(mode==='cancel')setTimeout(()=>control.abort(),200);
   if(mode==='pending'||mode==='unknown'||mode==='cancel')await assert.rejects(controller.waitForOptions({kind:'school',value:'虚构异步大学'},1000),error=>{reason=(error as Error).message;return mode==='cancel'?reason==='APPLICATION_CONTEXT_CHANGED:cancelled':reason==='OWNED_OPTIONS_NOT_SETTLED';});
   else if(mode==='failed')await assert.rejects(controller.waitForOptions({kind:'school',value:'虚构异步大学'}),error=>{reason=(error as Error).message;return reason==='OWNED_OPTIONS_REQUEST_FAILED';});
   else{snapshot=await controller.waitForOptions({kind:'school',value:'虚构异步大学'});if(mode==='delayed'){assert.ok(Date.now()-started>8500);assert.equal(snapshot.options.length,1);await controller.choose(snapshot.options[0].ref,{kind:'school',value:'虚构异步大学'});}else{assert.equal(snapshot.options.length,0);assert.equal(snapshot.queryState,'settled');assert.ok(snapshot.canCreate);}}
  }finally{await controller.dispose().catch(()=>{});}
  assert.equal(await page.evaluate('window.creates'),0);assert.equal(await page.evaluate('window.submits'),0);assert.equal(await page.locator('#consent').isChecked(),false);assert.deepEqual(listeners(),before);
  report.cases[mode]={durationMs:Date.now()-started,reason,selected:await page.locator('#school').getAttribute('aria-valuetext'),created:0};
 }
 await page.goto(origin+'/?mode=delayed');const profile=structuredClone(overrideProfile);profile.career!.educations=profile.career!.educations.slice(0,1);profile.career!.educations[0]!.school='虚构异步大学';profile.career!.internships=[];profile.career!.projects=[];
 const result=await runUniversalFormAgent({page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:new AbortController().signal,contextId:'async-original',directory:join(directory,'original'),taskId:'async-original'});
 assert.equal(await page.locator('#school').getAttribute('aria-valuetext'),'虚构异步大学');assert.equal(result.verified,1);assert.equal(result.modelRequests,0);assert.equal(await page.evaluate('window.creates'),0);report.cases.originalBatch={verified:result.verified,modelRequests:0,created:0};
 // The framework replaces an option AFTER observation but BEFORE any click.
 // Recovery may reread that one owned control, but may never click stale DOM,
 // guess a new option, or repeat a click whose result is unknown.
 for(const replacement of ['same','different']){
  await page.setContent('<form onsubmit="window.submits++;return false"><label>学校名称<input id="school" role="combobox" aria-controls="menu" aria-valuetext="" onclick="menu.hidden=false;this.setAttribute(\'aria-expanded\',\'true\')"></label><div role="listbox" id="menu" hidden><div role="option">虚构异步大学</div></div><label>保留<input id="keep" value="KEEP"></label><input id="consent" type="checkbox"><button type="submit">提交申请</button></form><script>window.submits=0;window.selections=0;menu.onclick=e=>{if(e.target.getAttribute("role")!=="option")return;window.selections++;school.setAttribute("aria-valuetext",e.target.textContent);school.setAttribute("aria-expanded","false");menu.hidden=true}</script>');
  const controller=await createOwnedSelectController(page.locator('#school'),async()=>{},{label:'学校名称'});
  try{const before=await controller.open();assert.equal(before.options.length,1);await page.evaluate(value=>{document.querySelector('#menu')!.innerHTML='<div role="option">'+value+'</div>';},replacement==='same'?'虚构异步大学':'另一所大学');
   if(replacement==='same'){await controller.choose(before.options[0]!.ref,{kind:'school',value:'虚构异步大学'},async()=>{assert.equal(await page.locator('#keep').inputValue(),'KEEP')});assert.equal(await page.locator('#school').getAttribute('aria-valuetext'),'虚构异步大学');assert.equal(await page.evaluate('window.selections'),1);}
   else{await assert.rejects(controller.choose(before.options[0]!.ref,{kind:'school',value:'虚构异步大学'}),/OWNED_OPTION_NOT_FOUND/);assert.equal(await page.evaluate('window.selections'),0);}
   assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.evaluate('window.submits'),0);report.cases['replacedOption-'+replacement]={verified:replacement==='same',clicks:await page.evaluate('window.selections'),submitted:false};
  }finally{await controller.dispose();}
 }
 await page.setContent('<form onsubmit="window.submits++;return false"><fieldset><legend>项目经历</legend><label>项目名称<input aria-label="项目名称" value="'+overrideProfile.career!.projects[0]!.name+'"></label><label>项目描述<textarea id="description" aria-label="项目描述"></textarea></label></fieldset><label><input type="checkbox" id="consent">真实性声明</label><button type="submit">提交申请</button></form><script>window.submits=0</script>');
 const planSession=new UniversalFormSession(page,overrideProfile,async()=>overrideProfile,()=>1,new AbortController().signal,true);
 try{const observation=await planSession.inspect(),field=observation.page.fields.find(field=>field.label==='项目描述')!,fact=planSession.facts.find(fact=>fact.record==='project-1'&&fact.kind==='description')!;
  const result=await planSession.applyDecisionPlan({observation:observation.observation,mappings:[{target:'field-999999',fact:fact.ref}],selections:[],drafts:[{target:field.ref,facts:[fact.ref],text:fact.value,reason:'只整理同一项目的已确认内容'}]});
  assert.ok(result.results.some((item:any)=>item.reason==='UNKNOWN_FIELD'));assert.equal(await page.locator('#description').inputValue(),fact.value);assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.evaluate('window.submits'),0);report.cases.partialPlan={invalidReferenceRejected:true,unrelatedValidDraftRetained:true};
 }finally{planSession.close();}
 report.ok=true;await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:error instanceof Error?error.stack:String(error),report},null,2));throw error;}
finally{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();server.close();await bridge?.close();view.webContents.close();window.destroy();app.exit(report.ok?0:1);}
