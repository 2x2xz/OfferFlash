import {app,BrowserWindow,WebContentsView} from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {runUniversalFormAgent} from '../../packages/agent/src/universal-form-agent.js';
import {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import {overrideProfile} from './override-profile.js';
import type {Profile} from '../../packages/shared/src/contracts.js';

const directory=await mkdtemp(resolve('.backups/universal-preflight-browser-'));const phase=(value:string)=>appendFileSync(join(directory,'phases.jsonl'),JSON.stringify({phase:value,time:Date.now()})+'\n');phase('bootstrap');app.setPath('userData',directory);await app.whenReady();phase('app-ready');
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'preflight-fictional'}});window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1100,height:900});
let mode='',requests=0,totalRequests=0;const cases:Record<string,unknown>={};
const server=createServer(async(request,response)=>{
 let text='';for await(const chunk of request)text+=chunk;const body=JSON.parse(text);requests++;totalRequests++;
 if(mode==='failure'){response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:'Fictional provider failure for status regression.'}}));return;}
 const last=body.messages.findLast((message:any)=>message.role==='tool');let data:any;try{data=last?JSON.parse(last.content):undefined;}catch{}
 const snapshot=data?.next?.observation?data.next:data?.observation?data:undefined;
 let name='inspect_application',args:unknown={},finish=false;
 if(Array.isArray(data?.checks))finish=true;
 else if(snapshot){
  if(snapshot.fields?.length){
   const records=new Map<string,string>();for(const record of snapshot.records??[])for(const fact of record.facts)records.set(fact.ref,record.record);
   name='fill_application_group';args={observation:snapshot.observation,mappings:snapshot.fields.slice(0,12).map((field:any)=>({target:field.ref,fact:mode==='add'?field.candidates.find((ref:string)=>records.get(ref)==='education-2')??field.candidates[0]:field.candidates[0]}))};
  }else if(snapshot.actions?.length){name='add';args={observation:snapshot.observation,target:snapshot.actions[0].ref};}
  else if(snapshot.canMap){const field=snapshot.page.fields.find((field:any)=>field.label==='Study concentration'),record=snapshot.records.find((record:any)=>record.record==='education-1'),major=record.facts.find((fact:any)=>fact.label==='专业');assert.ok(field&&major);name='map_application_field';args={observation:snapshot.observation,target:field.ref,fact:major.ref};}
  else name='verify_application';
 }
 // Current foreground protocol consolidates remaining semantic work into one
 // host-validated plan. Keep field outcomes unchanged; only adapt the mock tool.
 if(body.tools?.some((tool:any)=>tool.function?.name==='apply_application_plan')){
  let initial:any;for(const message of body.messages??[])for(const content of typeof message.content==='string'?[message.content]:Array.isArray(message.content)?message.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text):[]){try{const value=JSON.parse(content);if(value.offerflashInitialObservation)initial=value.offerflashInitialObservation;}catch{}}
  if(!initial){response.writeHead(400);response.end('fixture initial observation missing');return;}const field=initial.page.fields.find((item:any)=>item.label==='Study concentration'),record=initial.records.find((record:any)=>record.record==='education-1'),major=record?.facts.find((fact:any)=>fact.label==='专业');
  name='apply_application_plan';args={observation:initial.observation,mappings:field&&major?[{target:field.ref,fact:major.ref}]:[],selections:[],drafts:[]};finish=false;
 }
 const common={id:'local-'+totalRequests,object:'chat.completion.chunk',created:1,model:'local-preflight-fixture'},delta=finish?{role:'assistant',content:'Only fictional tool receipts were checked.'}:{role:'assistant',tool_calls:[{index:0,id:'call-'+totalRequests,type:'function',function:{name,arguments:JSON.stringify(args)}}]};
 response.writeHead(200,{'content-type':'text/event-stream'});response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{},finish_reason:finish?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})+'\n\n');response.end('data: [DONE]\n\n');
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));phase('server-ready');const address=server.address();assert.ok(address&&typeof address!=='string');
const single:Profile=structuredClone(overrideProfile);single.career!.educations=single.career!.educations.slice(0,1);single.career!.projects=[];single.career!.publications=[];
const complete=()=>`<label>姓名<input id="name" value="${single.fullName}"></label><label>手机号<input id="phone" value="${single.phone}"></label><label>国家区号<input id="prefix" value="+86"></label><label>其它已有说明<input id="unknown-existing" value="ORIGINAL UNKNOWN TEXT"></label><fieldset><legend>教育经历</legend><label>学校名称<input value="虚构甲大学"></label><label>专业名称<input value="人工智能"></label></fieldset><fieldset><legend>实习经历</legend><label>公司名称<input value="虚构研究中心"></label><label>至今<input id="current" type="checkbox" checked value=""></label></fieldset>`;
const noiseHTML='<nav><form role="search"><label>搜索岗位<input id="site-search" type="search" placeholder="搜索岗位"></label><button type="button">查询</button></form></nav><label><span>同步更新在线简历</span> / <span>Synchronously update online resume</span><input id="sync" type="checkbox"></label>';
const pageHTML=(body:string,extra='')=>`<meta charset="utf-8"><form onsubmit="window.submits++;return false">${body}<label>同意隐私协议<input id="consent" type="checkbox"></label><button type="submit">提交申请</button></form>${extra}<script>window.writes=0;window.submits=0;document.addEventListener('input',()=>window.writes++);document.addEventListener('change',()=>window.writes++);</script>`;
let attached:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;
try{
 phase('view-load-start');await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(pageHTML(complete())));phase('view-loaded');attached=await attachPlaywrightView(view.webContents);phase('bridge-attached');const page=attached.page;
 const run=async(name:string,content:string,profile=single)=>{
  mode=name;requests=0;phase(name+':set-content');await page.setContent(pageHTML(content,name==='peripheral'?noiseHTML:''));phase(name+':content-ready');
  const provider=await BackgroundModelProvider.create({mode:'live',provider:'custom',modelId:'local-preflight-fixture',apiKey:'fictional-local-only',baseURL:`http://127.0.0.1:${address.port}/v1`},2500,'universal');let independentChecks=0;
  phase(name+':provider-ready');try{const result=await runUniversalFormAgent({page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:new AbortController().signal,provider,directory:join(directory,name),taskId:name,independentVerify:async read=>{independentChecks++;phase(name+':verify-start');const value=await read();phase(name+':verify-returned');return value;}});phase(name+':agent-returned');assert.equal(result.modelRequests,requests);assert.ok(independentChecks>0);assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.evaluate('window.submits'),0);cases[name]={...result,requests,independentChecks};await writeFile(join(directory,'case-'+name+'.json'),JSON.stringify(cases[name],null,2));return result;}finally{provider.close();}
 };
 const correct=await run('correct',complete());assert.equal(requests,0);assert.equal(correct.status,'completed');assert.equal(correct.verified,0);assert.equal(correct.matchedConfirmed,6);assert.equal(correct.alreadyCorrect,6);assert.equal(correct.modelTokens,0);assert.equal(await page.evaluate('window.writes'),0);assert.ok(correct.message.includes('原本已正确'));assert.ok(!correct.message.includes('没有核实成功'));assert.equal(await page.locator('#prefix').inputValue(),'+86');assert.equal(await page.locator('#unknown-existing').inputValue(),'ORIGINAL UNKNOWN TEXT');assert.equal(await page.locator('#current').isChecked(),true);
 const peripheral=await run('peripheral',complete());assert.equal(requests,0);assert.equal(peripheral.status,'completed');assert.equal(peripheral.pending,0);assert.equal(peripheral.matchedConfirmed,6);assert.equal(peripheral.verified,0);assert.ok(!peripheral.remaining?.some(field=>field.question));assert.equal(await page.locator('#site-search').inputValue(),'');assert.equal(await page.locator('#sync').isChecked(),false);assert.equal(await page.evaluate('window.writes'),0);
 const missing=await run('missing',complete().replace('</fieldset>','<label>GPA/CGPA<input id="gpa"></label></fieldset>')+'<section><h2>语言能力</h2><label>语言类型<input id="language"></label><label>掌握程度<input></label><label>听说<input></label><label>读写<input></label></section>');assert.equal(requests,0);assert.equal(missing.status,'partial');assert.equal(missing.verified,0);assert.equal(missing.matchedConfirmed,6);assert.ok((missing.pending??0)>=5);assert.equal(await page.locator('#gpa').inputValue(),'');assert.equal(await page.locator('#language').inputValue(),'');assert.equal(await page.evaluate('window.writes'),0);
 const mapping=await run('mapping','<fieldset><legend>教育经历</legend><label>学校名称<input value="虚构甲大学"></label><label>Study concentration<input id="concentration"></label></fieldset>');assert.ok(requests>0);assert.equal(mapping.status,'partial');assert.equal(mapping.missingRecords,1);assert.equal(mapping.verified,1);assert.equal(mapping.matchedConfirmed,2);assert.equal(mapping.alreadyCorrect,1);assert.equal(await page.locator('#concentration').inputValue(),'人工智能');assert.ok(mapping.message.includes('新填写并独立核实 1 项'));assert.ok(mapping.message.includes('当前页面有 2 项'));
 const contact=await run('contact',`<label>姓名<input value="${single.fullName}"></label><label>邮箱<input id="email" type="email"></label>`);assert.equal(requests,0);assert.equal(contact.status,'partial');assert.ok((contact.missingRecords??0)>=1);assert.equal(contact.verified,1);assert.equal(contact.matchedConfirmed,2);assert.equal(contact.alreadyCorrect,1);assert.equal(await page.locator('#email').inputValue(),single.email);
 const two:Profile=structuredClone(single);two.career!.educations=structuredClone(overrideProfile.career!.educations);two.career!.internships=[];
 const added=await run('add',`<section><h2>教育经历</h2><fieldset><legend>教育经历</legend><label>学校名称<input value="虚构甲大学"></label><label>专业名称<input value="人工智能"></label></fieldset><button type="button" id="add-education" onclick="this.insertAdjacentHTML('beforebegin','&lt;fieldset&gt;&lt;legend&gt;教育经历&lt;/legend&gt;&lt;label&gt;学校名称&lt;input id=second-school&gt;&lt;/label&gt;&lt;label&gt;专业名称&lt;input id=second-major&gt;&lt;/label&gt;&lt;/fieldset&gt;')">添加教育经历</button></section>`,two);assert.equal(requests,0);assert.equal(added.status,'completed');assert.equal(added.verified,2);assert.equal(added.matchedConfirmed,4);assert.equal(await page.locator('#second-school').inputValue(),'虚构乙大学');assert.equal(await page.locator('#second-major').inputValue(),'统计学');
 const failed=await run('failure','<fieldset><legend>教育经历</legend><label>学校名称<input value="虚构甲大学"></label><label>Study concentration<input id="failure-concentration"></label></fieldset>');assert.equal(failed.status,'failed');assert.equal(failed.verified,0);assert.equal(failed.matchedConfirmed,1);assert.equal(failed.failureCode,'execution-interrupted');assert.ok(requests>0);
 const report={universalPreflight:true,ok:true,cases,totalScriptedRequests:totalRequests,paidRequests:0,externalRequests:0};await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await attached.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));view.webContents.close();window.destroy();app.exit(0);
}catch(error){console.error(error);server.closeAllConnections();server.close();window.destroy();app.exit(1);}
