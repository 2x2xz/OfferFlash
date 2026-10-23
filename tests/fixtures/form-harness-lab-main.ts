import {app,BrowserWindow,WebContentsView} from 'electron';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {fauxAssistantMessage,fauxToolCall,type TranscriptContext} from '@earendil-works/pi-ai';
import {createDemoModel} from '../../packages/runtime/src/demo-model.js';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {runExperimentalFormHarness} from '../../packages/agent/src/experimental-form-harness.js';
import {FormHarnessRecipes} from '../../packages/agent/src/form-harness-recipes.js';
import {runUniversalFormAgent} from '../../packages/agent/src/universal-form-agent.js';
import type {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import type {Profile} from '../../packages/shared/src/contracts.js';

const directory=process.env.OFFERFLASH_HARNESS_LAB_DIR!;if(!directory)throw Error('ISOLATED_LAB_DIRECTORY_REQUIRED');
app.setPath('userData',join(directory,'user-data'));await app.whenReady();
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{partition:'offerflash-harness-lab',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1100,height:850});
const profile:Profile={version:1,updatedAt:'',fullName:'虚构候选人',fullNameEn:'Fictional Candidate',email:'fixture@example.invalid',phone:'2025550100',school:'虚构大学',schoolEn:'',degree:'硕士',major:'计算机',majorEn:'',graduationMonth:'2027-06',skills:[],cities:[],targetRoles:[],resumeText:'',career:{schemaVersion:1,sources:[],primaryEducationId:'e1',educations:[{id:'e1',school:'虚构大学',schoolEn:'',major:'计算机',majorEn:'',degree:'硕士',startDate:'2025-09',endDate:'2027-06',description:'',evidence:[],sourceNote:'',confirmation:'confirmed',revision:1,confirmedRevision:1,confirmedAt:'2026-10-01'}],internships:[],projects:[],publications:[]}};
const html=(mode='tabbed')=>`<style>body{font:16px sans-serif} [role=listbox]{padding:15px;border:1px solid;width:450px} [role=option]{padding:14px} button{padding:10px}</style><form onsubmit="window.submits++;return false"><fieldset><legend>教育经历</legend><label>学校名称<input value="虚构大学"></label><div><label>学历<div tabindex="0" role="combobox" aria-label="学历" aria-controls="picker" aria-valuetext="" id="degree" onclick="picker.hidden=false;this.setAttribute('aria-expanded','true')" onkeydown="if(event.key==='Escape'){picker.hidden=true;this.setAttribute('aria-expanded','false')}">请选择</div></label></div></fieldset>
 <div id="picker" role="listbox" hidden>
 <div role="tablist"><button type="button" role="tab" aria-controls="base" aria-selected="true">基础</button><button id="advanced" type="button" role="tab" aria-controls="detail" aria-selected="false" onclick="base.hidden=true;detail.hidden=false;this.setAttribute('aria-selected','true');${mode==='mutating'?"degree.setAttribute('aria-valuetext','本科');":''}">${mode==='renamed'?'另一入口':'进阶'}</button>
 <button type="submit" role="tab" aria-controls="detail">危险提交</button><button type="button" role="tab" aria-controls="outside">站外区域</button><button type="button" role="tab" aria-controls="detail">删除全部</button></div>
 <div id="base" role="tabpanel"><div role="option">本科</div></div><div id="detail" role="tabpanel" ${mode==='direct'?'':'hidden'}><div role="option" onclick="degree.setAttribute('aria-valuetext','硕士');degree.setAttribute('aria-expanded','false');picker.hidden=true">硕士</div><div role="option" onclick="degree.setAttribute('aria-valuetext','博士');degree.setAttribute('aria-expanded','false');picker.hidden=true">博士</div></div></div>
 <div id="outside">不属于弹层</div><label>保留备注<input id="sentinel" readonly value="KEEP"></label><label><input id="consent" type="checkbox">同意真实性声明</label><button type="submit" id="submit">提交申请</button></form><script>window.submits=0</script>`;

const messageText=(message:{content:string|Array<any>})=>typeof message.content==='string'?message.content:message.content.filter(block=>block.type==='text').map(block=>block.text).join('');
const contextData=(context:TranscriptContext):any=>{
 const message=context.messages.findLast(message=>message.role==='toolResult'||message.role==='user');if(!message)throw Error('MODEL_CONTEXT_MISSING');
 const data=JSON.parse(messageText(message));
 return message.role==='user'?{next:data.offerflashInitialObservation}:data;
};
const field=(data:any)=>{const actual=data.next.page.fields.find((item:any)=>item.label==='学历');assert.ok(actual);return actual;};
const call=(name:string,args:any)=>fauxAssistantMessage(fauxToolCall(name,args),{stopReason:'toolUse'});
const report:any={kind:'scripted-sdk-and-isolated-browser-mechanism-comparison',paidRequests:0,externalWebsiteRequests:0,cases:{}};
const recipes=new FormHarnessRecipes(join(directory,'recipes.json'));
let bridge:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html()));bridge=await attachPlaywrightView(view.webContents);const page=bridge.page;
 const reset=async(mode:string)=>{await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent(html(mode)));};
 const checkPreserved=async()=>{assert.equal(await page.locator('#sentinel').inputValue(),'KEEP');assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.evaluate('window.submits'),0);};
 // Same baseline engine and same authored page/profile. Scripted responses
 // measure available mechanisms, not a live model's decision accuracy.
 const baseline=await createDemoModel();baseline.faux.setResponses([context=>{const message=context.messages.findLast(message=>message.role==='user')!;const input=JSON.parse(messageText(message));return call('apply_application_plan',{observation:input.offerflashInitialObservation.observation,selections:[],drafts:[]});}]);
 const baselineResult=await runUniversalFormAgent({page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:new AbortController().signal,directory:join(directory,'baseline'),taskId:'baseline',provider:{runtime:baseline.modelRuntime,model:baseline.model,attempts:[],withTaskLimit:(_id:string,_limit:number,run:()=>Promise<any>)=>run()} as unknown as BackgroundModelProvider});
 assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'');await checkPreserved();report.cases.baselineTabbed={verified:baselineResult.verified,pending:baselineResult.pending,scriptedModelRequests:baseline.faux.state.callCount,performance:baselineResult.performance};

 const run=async(name:string,mode:string,behavior:'explore'|'recipe'|'invalid'|'loop'|'mutating'|'cancel'|'batch'|'stale'|'foreignFact',maxRequests=8,maxActions=32,factsProfile=profile)=>{
  await reset(mode);const demo=await createDemoModel();let stage=0,generation=1;
  demo.faux.setResponses(Array.from({length:20},()=>context=>{
   const data=contextData(context),target=field(data),observation=data.next.observation,fact=target.candidates[0];
   const next=stage++;
   if(behavior==='loop')return call('inspect_application',{});
   if(behavior==='cancel'){if(next===0)return call('act_control',{observation,target:target.ref,action:'open'});generation=2;return call('inspect_application',{});}
   if(behavior==='batch')return next===0?call('fill_confirmed',{observation}):fauxAssistantMessage('批量填写后结束。');
   if(behavior==='stale')return next===0?call('act_control',{observation:'observation-stale',target:target.ref,action:'fill',fact}):fauxAssistantMessage('旧观察未执行写入。');
   if(behavior==='foreignFact')return next===0?call('act_control',{observation,target:target.ref,action:'fill',fact:'fact-0'}):fauxAssistantMessage('其它字段事实未写入。');
   if(behavior==='recipe')return next===0?call('run_control_recipe',{observation,target:target.ref,fact,recipe:data.next.recipes[0].recipe}):fauxAssistantMessage('结束，以独立回读为准。');
   if(behavior==='invalid')return next===0?call('act_control',{observation,target:target.ref,action:'open'}):next===1?call('navigate_control',{observation,target:target.ref,navigation:'invented-navigation'}):fauxAssistantMessage('无效导航未执行。');
   if(next===0)return call('act_control',{observation,target:target.ref,action:'open'});
   if(next===1)return call('inspect_control',{observation,target:target.ref});
   if(next===2){const navigation=data.result.navigation;assert.deepEqual(navigation.map((entry:any)=>entry.label),['基础','进阶']);return call('navigate_control',{observation,target:target.ref,navigation:navigation.find((entry:any)=>entry.label==='进阶').ref});}
   if(next===3)return call('act_control',{observation,target:target.ref,action:'choose',fact});
   if(next===4)return call('verify_application',{});
   return fauxAssistantMessage('以已核实字段和未完成项结束。');
  }));
  const result=await runExperimentalFormHarness({page,profile:factsProfile,getProfile:async()=>factsProfile,getGeneration:()=>generation,signal:new AbortController().signal,directory:join(directory,name),model:{runtime:demo.modelRuntime,model:demo.model},recipes,maxRequests,maxActions});
  assert.equal(result.modelRequests,demo.faux.state.callCount);await checkPreserved();report.cases[name]={status:result.status,stopReason:result.stopReason,verified:result.verification?.verified??0,pending:result.verification?.pending??null,requests:result.modelRequests,actions:result.actions,performance:result.performance,events:result.events};return result;
 };
 const explored=await run('exploration','tabbed','explore');assert.equal(explored.verification?.verified,1);assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'硕士');assert.equal(recipes.list().length,1);assert.equal(explored.status,'completed');
 const replayed=await run('recipeReplay','tabbed','recipe');assert.equal(replayed.verification?.verified,1);assert.ok(replayed.modelRequests<explored.modelRequests);
 const doctorate=structuredClone(profile);doctorate.version=2;doctorate.career!.educations[0]!.degree='博士';doctorate.career!.educations[0]!.revision=2;doctorate.career!.educations[0]!.confirmedRevision=2;
 const newFacts=await run('recipeWithDifferentFacts','tabbed','recipe',8,32,doctorate);assert.equal(newFacts.verification?.verified,1);assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'博士');
 const changed=await run('changedStructure','renamed','recipe');assert.equal(changed.verification?.verified,0);assert.ok(changed.events.some(event=>event.reason==='RECIPE_STRUCTURE_CHANGED'));assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'');
 assert.equal(recipes.list().length,0,'A stale method must be invalidated instead of offered on every run');
 const invalid=await run('invalidReference','tabbed','invalid');assert.equal(invalid.verification?.verified,0);assert.ok(invalid.events.some(event=>event.reason==='OWNED_NAVIGATION_EXPIRED'));
 const mutating=await run('unexpectedWrite','mutating','mutating');assert.equal(mutating.verification?.verified,0);assert.ok(mutating.events.some(event=>event.reason==='NAVIGATION_CHANGED_VALUE'));assert.ok(mutating.events.some(event=>event.reason==='PRIOR_WRITE_UNVERIFIED'));assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'本科');
 const limited=await run('requestBudget','tabbed','loop',2);assert.equal(limited.modelRequests,2);assert.equal(limited.stopReason,'HARNESS_MODEL_BUDGET');
 const actionLimited=await run('actionBudget','tabbed','loop',8,1);assert.equal(actionLimited.actions,1);assert.equal(actionLimited.stopReason,'HARNESS_ACTION_BUDGET');
 const cancelled=await run('documentChanged','tabbed','cancel');assert.equal(cancelled.status,'cancelled');assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'');
 const stale=await run('staleObservation','tabbed','stale');assert.equal(stale.verification?.verified,0);assert.ok(stale.events.some(event=>event.reason==='FRESH_OBSERVATION_REQUIRED'));assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'');
 const direct=await run('candidateDirect','direct','batch');assert.equal(direct.verification?.verified,1);
 const foreign=await run('foreignFact','tabbed','foreignFact');assert.equal(foreign.verification?.verified,0);assert.ok(foreign.events.some(event=>event.reason==='FACT_FIELD_MISMATCH'));assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'),'');
 // Ensure ordinary direct selection still works in the original engine after
 // extending its controller interface; the normal entry is unchanged.
 await reset('direct');const simple=await runUniversalFormAgent({page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:new AbortController().signal,directory:join(directory,'baseline-direct'),taskId:'baseline-direct'});assert.equal(simple.verified,1);await checkPreserved();report.cases.baselineDirect={verified:simple.verified,pending:simple.pending};
 report.ok=true;report.recipeCount=recipes.list().length;await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:error instanceof Error?error.stack:String(error),report},null,2));throw error;}
finally{await bridge?.close();view.webContents.close();window.destroy();app.exit(report.ok?0:1);}
