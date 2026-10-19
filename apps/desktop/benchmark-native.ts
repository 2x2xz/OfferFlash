import {BrowserWindow} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {BrowserController} from '../../packages/browser/src/controller.js';
import {renderFormFixture,readFormAudit,type FormFixtureCase,type FormAudit} from '../../packages/evaluation/src/form-fixture.js';
import {scoreForm} from '../../packages/evaluation/src/form-scoring.js';
import {buildFillPlan} from '../../packages/forms/src/index.js';
import {buildModelFormInput,recognizeModelForm,type ModelFormResult} from '../../packages/forms/src/model-recognition.js';
import {TelemetryStore} from '../../packages/telemetry/src/store.js';
import type {FormRun} from '../../packages/evaluation/src/contracts.js';
import type {Profile,FormObservation,FillPlan} from '../../packages/shared/src/contracts.js';
export interface FrozenFormMapping {inputHash:string;response:ModelFormResult;requestId:string;}
/** Actual guarded native executor on owned local files. Never focuses again after losing foreground. */
export async function nativeFormBenchmark(cases:FormFixtureCase[],profile:Profile,output:string,mappings?:Record<string,FrozenFormMapping>){
 const executionDetails:any[]=[];const results:FormRun[]=[],observations:Record<string,FormObservation>={},traces:unknown[]=[];
 await mkdir(join(output,'native-fixtures'),{recursive:true,mode:0o700});
 const window=new BrowserWindow({show:false,width:1340,height:960,title:'OfferFlash Benchmark · 原创虚构表单（不提交）',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="margin:0;background:#141922;color:#d8e3f0;font:14px monospace"><div style="height:48px;padding:12px">OfferFlash Benchmark · 原创虚构资料 · 不上传/不提交 · 失焦即停</div></body></html>'));
 window.show();window.focus();await delay(250);let lostFocus=!window.isFocused(),active=false;
 window.on('blur',()=>{if(active)lostFocus=true;});
 const telemetry=await TelemetryStore.create(join(output,'native-telemetry'));
 try{for(const scenario of cases){
  const start=performance.now(),file=join(output,'native-fixtures',scenario.id+'.html');await writeFile(file,renderFormFixture(scenario),{mode:0o600});
  const browser=new BrowserController({window,onState:()=>{},getProfile:async()=>structuredClone(profile),testFormPath:file,enableFieldCompanion:true,fillRetryLimit:2});
  browser.resize({x:0,y:48,width:1320,height:860});browser.setVisible(true);
  const session=browser.view.webContents.session;session.webRequest.onBeforeRequest((details,callback)=>{callback({cancel:!details.url.startsWith('file://'+output+'/native-fixtures/')});});
  let fillResult:any,audit:FormAudit|undefined,errorCode:string|undefined,plan:FillPlan|undefined,cleanStartConfirmed=false;let geometry:FormRun['geometry'];
  let run=await telemetry.begin({mode:'agent',source:'fixture',scenarioKey:'native:'+scenario.id,cleanStartConfirmed:false});
  try{
   await browser.openTestForm();
   const initial=await browser.view.webContents.executeJavaScript(readFormAudit(scenario.fields.map(f=>f.domId))) as FormAudit;cleanStartConfirmed=scenario.fields.every(f=>initial.values[f.domId]===f.initialValue)&&initial.events.length===0&&initial.submits===0&&initial.filesTouched===0;if(!cleanStartConfirmed)throw new Error('Independent initial state mismatch');
   geometry=await browser.view.webContents.executeJavaScript(`({scrollHeight:document.documentElement.scrollHeight,initialOffscreenFields:${JSON.stringify(scenario.fields.map(f=>f.domId))}.filter(id=>document.getElementById(id).getBoundingClientRect().top>innerHeight),finalScrollY:scrollY})`);
   plan=await telemetry.step('form.recognize',()=>browser.preparePlan(async(observation,current)=>{
    observations[scenario.id]=observation;
    if(!mappings)return buildFillPlan(observation,current);
    const mapping=mappings[scenario.id],input=buildModelFormInput(observation,current);
    if(!mapping||mapping.inputHash!==createHash('sha256').update(JSON.stringify(input)).digest('hex'))throw new Error('Live mapping input no longer identical');
    const accepted=await recognizeModelForm(observation,current,async()=>mapping.response);if(accepted.recognition?.mode!=='model')throw new Error('Frozen model mapping not accepted');return accepted;
   }));
   if(lostFocus||!window.isFocused()){lostFocus=true;errorCode='foreground-unavailable';}
   else{const ids=plan.items.filter(item=>item.status==='ready').map(item=>item.fieldId);active=true;
    if(ids.length)fillResult=await telemetry.step('form.fill',()=>browser.fillApproved(plan!.id,ids));active=false;
   }
  }catch{active=false;errorCode=lostFocus?'foreground-lost':'guard-or-execution-stop';}
  try{await delay(350);audit=await telemetry.step('form.verify',()=>browser.view.webContents.executeJavaScript(readFormAudit(scenario.fields.map(f=>f.domId))));}catch{errorCode='independent-read-failed';}
  if(geometry)geometry.finalScrollY=await browser.view.webContents.executeJavaScript('scrollY');
  const score=scoreForm({fields:scenario.fields.map(f=>({fieldId:f.domId,required:f.required,kind:f.kind,initialValue:f.initialValue,...(f.expectedValues?{expectedValues:f.expectedValues}:{}),...(f.protection?{protection:f.protection}:{})})),finalValues:audit?.values??{},...(audit?{mutations:audit.events.filter(e=>e.cause==='agent-input').map(({fieldId,before,after})=>({fieldId,before,after}))}:{})});
  const status=errorCode?.startsWith('foreground')?'blocked':errorCode?'failed':score.automationTaskSuccess?'succeeded':'partial';
  run=await telemetry.finish({id:run.id,status:status==='succeeded'?'completed':status==='partial'?'partial':'failed'});traces.push(run);
  results.push({caseId:scenario.id,split:(scenario as any).split,engine:mappings?'production-foreground-live-mapping-replay':'production-foreground-rules',repeat:0,durationMs:performance.now()-start,status,score,...(errorCode?{errorCode}:{}),...(mappings?.[scenario.id]?{requestId:mappings[scenario.id]!.requestId}:{}),traceId:run.traceId,independentFinalRead:!!audit,mutationAuditAvailable:!!audit,environmentMutations:audit?.events.filter(e=>e.cause==='environment-injection').length??0,submissions:audit?.submits??null,filesTouched:audit?.filesTouched??null,clicks:audit?.clicks??null,cleanStartConfirmed,...(geometry?{geometry}:{})});
  executionDetails.push({caseId:scenario.id,plan:plan?.items.map(({value,currentValue,...item})=>item),result:fillResult,errorCode});
  browser.dispose();
 }}finally{await telemetry.close();if(!window.isDestroyed())window.destroy();}
 await writeFile(join(output,'native-execution-details.json'),JSON.stringify(executionDetails,null,2),{mode:0o600});
 return {results,observations,traces,focusLost:lostFocus};
}
