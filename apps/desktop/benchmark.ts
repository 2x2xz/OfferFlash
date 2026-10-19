/** Owned isolated Chromium benchmark. It never attaches a normal application or reads its store/session. */
import {app,WebContentsView,session} from 'electron';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {nativeFormBenchmark} from './benchmark-native.js';
import {renderFormFixture,readFormAudit,type FormFixtureCase,type FormAudit} from '../../packages/evaluation/src/form-fixture.js';
import {scoreForm} from '../../packages/evaluation/src/form-scoring.js';
import {runBackgroundOrdinaryFill,backgroundFormObservation} from '../../packages/browser/src/background-executor.js';
import {BACKGROUND_READ_FORM,backgroundWriteScript} from '../../packages/browser/src/background-scripts.js';
import {TelemetryStore} from '../../packages/telemetry/src/store.js';
import type {Profile,FormObservation} from '../../packages/shared/src/contracts.js';
import type {FormRun} from '../../packages/evaluation/src/contracts.js';
const flag=(name:string,fallback='')=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
if(!process.argv.includes('--isolated-benchmark'))throw new Error('Explicit isolated benchmark required');
const dataPath=resolve(flag('dataset')),output=resolve(flag('output')),repeats=Number(flag('repeats','3'));
if(!/\.(?:backups|publish|export)(?:\/|$)/.test(output)&&!output.includes('/runtime-home/'))throw new Error('Benchmark output must be ignored local data');
if(!Number.isSafeInteger(repeats)||repeats<1||repeats>10)throw new Error('Invalid repeats');
await mkdir(output,{recursive:true,mode:0o700});app.setName('OfferFlash Benchmark');app.setPath('userData',join(output,'browser-state'));app.setPath('sessionData',join(output,'browser-state/session'));await mkdir(app.getPath('sessionData'),{recursive:true,mode:0o700});
await app.whenReady();app.on('window-all-closed',()=>{});
const dataset=JSON.parse(await readFile(dataPath,'utf8')) as {profile:Profile;cases:FormFixtureCase[]};
let currentHTML='',externalRequests=0,serverRequests=0;
const server=createServer((req,res)=>{serverRequests++;if(req.method!=='GET'||!req.url?.startsWith('/form')){res.writeHead(403).end();return;}res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});res.end(currentHTML);});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw new Error('Invalid local server');const origin=`http://127.0.0.1:${address.port}`;
const ownSession=session.fromPartition('benchmark-'+randomUUID());ownSession.setPermissionRequestHandler((_c,_p,callback)=>callback(false));ownSession.setPermissionCheckHandler(()=>false);
ownSession.webRequest.onBeforeRequest((details,callback)=>{const allowed=details.url.startsWith(origin+'/form');if(!allowed)externalRequests++;callback({cancel:!allowed});});
const results:FormRun[]=[],observations:Record<string,FormObservation>={},traces:unknown[]=[];
const telemetry=await TelemetryStore.create(join(output,'telemetry'));
let exitCode=0;
try{
 if(!process.argv.includes('--native-only'))for(const scenario of dataset.cases)for(let repeat=0;repeat<repeats;repeat++){
  currentHTML=renderFormFixture(scenario);
  const view=new WebContentsView({webPreferences:{session:ownSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});view.setBounds({x:0,y:0,width:1280,height:900});view.setVisible(false);
  const contents=view.webContents;let generation=0;contents.on('did-start-navigation',(_e,_u,_p,main)=>{if(main)generation++;});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let errorCode:string|undefined,audit:FormAudit|undefined,cleanStartConfirmed=false;let geometry:FormRun['geometry'];const started=performance.now();
  let trace:Awaited<ReturnType<TelemetryStore['begin']>>|undefined;
  try{
   await contents.loadURL(origin+'/form?case='+encodeURIComponent(scenario.id)+'&repeat='+repeat);
   const initial=await contents.executeJavaScript(readFormAudit(scenario.fields.map(f=>f.domId))) as FormAudit;
   cleanStartConfirmed=scenario.fields.every(f=>initial.values[f.domId]===f.initialValue)&&initial.events.length===0&&initial.submits===0&&initial.filesTouched===0;
   if(!cleanStartConfirmed)throw new Error('Independent initial state mismatch');
   geometry=await contents.executeJavaScript(`({scrollHeight:document.documentElement.scrollHeight,initialOffscreenFields:${JSON.stringify(scenario.fields.map(f=>f.domId))}.filter(id=>document.getElementById(id).getBoundingClientRect().top>innerHeight),finalScrollY:scrollY})`);
   trace=await telemetry.begin({mode:'agent',source:'fixture',scenarioKey:'bench:'+scenario.id,expectedFields:scenario.fields.filter(f=>f.kind==='eligible'||f.kind==='unsupported').length,cleanStartConfirmed});
   const fresh=await contents.executeJavaScript(BACKGROUND_READ_FORM);if(repeat===0)observations[scenario.id]=backgroundFormObservation(fresh,generation);
   const transport={read:()=>telemetry.step('form.observe',()=>contents.executeJavaScript(BACKGROUND_READ_FORM)),write:(input:Parameters<typeof backgroundWriteScript>[0])=>telemetry.step('form.fill',()=>contents.executeJavaScript(backgroundWriteScript(input))),getProfile:async()=>structuredClone(dataset.profile),getURL:()=>contents.getURL(),getGeneration:()=>generation};
   await telemetry.step('agent.task',()=>runBackgroundOrdinaryFill(transport,dataset.profile,controller.signal,()=>{}));
  }catch{errorCode=controller.signal.aborted?'bounded-timeout':'guard-or-execution-stop';}
  try{await delay(350);audit=await telemetry.step('form.verify',()=>contents.executeJavaScript(readFormAudit(scenario.fields.map(f=>f.domId))));}catch{errorCode='independent-read-failed';}
  const score=scoreForm({fields:scenario.fields.map(f=>({fieldId:f.domId,required:f.required,kind:f.kind,initialValue:f.initialValue,...(f.expectedValues?{expectedValues:f.expectedValues}:{}),...(f.protection?{protection:f.protection}:{} )})),finalValues:audit?.values??{},...(audit?{mutations:audit.events.filter(e=>e.cause==='agent-input').map(({fieldId,before,after})=>({fieldId,before,after}))}:{})});
  if(audit&&(audit.filesTouched>0||audit.clicks>0||audit.activeElement!=='BODY'))errorCode='background-safety-audit-failed';
  if(geometry)geometry.finalScrollY=await contents.executeJavaScript('scrollY');
  if(!trace)trace=await telemetry.begin({mode:'agent',source:'fixture',scenarioKey:'bench:'+scenario.id,cleanStartConfirmed:false});
  const durationMs=performance.now()-started,status=errorCode?'failed':score.automationTaskSuccess?'succeeded':'partial';
  trace=await telemetry.finish({id:trace.id,status:status==='succeeded'?'completed':status==='partial'?'partial':'failed'});traces.push(trace);
  results.push({caseId:scenario.id,split:(scenario as any).split,engine:'production-background-dom',repeat,durationMs,status,score,...(errorCode?{errorCode}:{}),traceId:trace.traceId,independentFinalRead:!!audit,mutationAuditAvailable:!!audit,environmentMutations:audit?.events.filter(e=>e.cause==='environment-injection').length??0,submissions:audit?.submits??null,filesTouched:audit?.filesTouched??null,clicks:audit?.clicks??null,cleanStartConfirmed,backgroundFocusPreserved:audit?audit.activeElement==='BODY'&&!contents.isFocused():null,...(geometry?{geometry}:{})});
  clearTimeout(timer);contents.close();await writeFile(join(output,'progress.json'),JSON.stringify({completed:results.length,total:dataset.cases.length*repeats,lastCase:scenario.id}));
 }
 if(process.argv.includes('--native')){const mappingPath=flag('model-mappings');const mappings=mappingPath?JSON.parse(await readFile(resolve(mappingPath),'utf8')):undefined;const native=await nativeFormBenchmark(dataset.cases.filter(c=>!mappings||Object.hasOwn(mappings,c.id)),dataset.profile,output,mappings);results.push(...native.results);Object.assign(observations,native.observations);traces.push(...native.traces);}
 await writeFile(join(output,'forms.json'),JSON.stringify({scope:'owned-Chromium-production-background-DOM',results,observations,traces,externalRequests,serverRequests,normalUserDataRead:false,nativeOSInputCount:process.argv.includes('--native')?null:0,nativeOSExecutionRequested:process.argv.includes('--native'),submissions:results.some(r=>r.submissions===null)?null:results.reduce((n,r)=>n+(r.submissions??0),0)},null,2));
 exitCode=results.some(r=>!r.independentFinalRead||r.submissions===null||r.submissions>0)||externalRequests?2:0;
}catch{await writeFile(join(output,'failure.json'),JSON.stringify({code:'BROWSER_BENCHMARK_FAILED',completed:results.length}));exitCode=2;}
finally{await telemetry.close();await new Promise<void>(done=>server.close(()=>done()));app.exit(exitCode);}
