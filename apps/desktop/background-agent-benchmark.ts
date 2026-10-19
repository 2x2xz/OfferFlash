/** Real-model evaluation through the same App store, queue, pages and Pi task agent. */
import {session} from 'electron';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import type {BackgroundQueueHost} from './background-queue.js';
import type {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import {readBenchmarkCredential} from '../../packages/evaluation/src/credential-input.js';
import {readResume} from '../../packages/profile/src/import.js';
import {pickCareerInput} from '../../packages/profile/src/career-input.js';
import {qaRequestAllowed} from './real-site-qa.js';

const arms=[{id:'baseline-c1',variant:'baseline',concurrency:1},{id:'improved-c1',variant:'improved',concurrency:1},
 {id:'improved-c3',variant:'improved',concurrency:3},{id:'improved-c5',variant:'improved',concurrency:5}] as const;
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const normalized=(s:string)=>s.replace(/[*✱:：]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const inputProfile=(p:any)=>{const {version,updatedAt,...rest}=p;return {...rest,career:pickCareerInput(p.career)};};
function auditGold(job:any,before:any,after:any){
 const rows=(job.gold??[]).map((g:any)=>{const initial=before.filter((f:any)=>normalized(f.label)===g.label&&['text','email','tel'].includes(f.type));
  const final=after.filter((f:any)=>normalized(f.label)===g.label&&['text','email','tel'].includes(f.type));
  const status=initial.length!==1||final.length!==1?'unresolved':initial[0].value.trim()?'initial-nonempty':final[0].value===g.expected?'correct':!final[0].value?'empty':'wrong';
  return {label:g.label,key:g.key,status};});
 return {eligible:rows.length,correct:rows.filter((r:any)=>r.status==='correct').length,empty:rows.filter((r:any)=>r.status==='empty').length,
   wrong:rows.filter((r:any)=>r.status==='wrong').length,unresolved:rows.filter((r:any)=>r.status==='unresolved').length,
   initialNonempty:rows.filter((r:any)=>r.status==='initial-nonempty').length,rows};
}
export async function runBackgroundAgentBenchmark(o:{directory:string;resumePath:string;casesPath:string;baselineManifestPath:string;limit?:number;armIds?:string[];
 methods:Record<string,(...args:any[])=>Promise<any>>;queue:BackgroundQueueHost;getProvider():BackgroundModelProvider|undefined;notify(s:string):void}){
 await mkdir(o.directory,{recursive:true,mode:0o700});
 const baselineManifest=JSON.parse(await readFile(o.baselineManifestPath,'utf8'));
 const baselineBytes=await readFile(baselineManifest.artifact);if(hash(baselineBytes)!==baselineManifest.sha256)throw Error('BASELINE_HASH_MISMATCH');
 const frozenBaseline=await import(pathToFileURL(baselineManifest.artifact).href);if(typeof frozenBaseline.runBackgroundFormAgent!=='function')throw Error('BASELINE_RUNNER_REQUIRED');
 const caseBytes=await readFile(o.casesPath),cases=JSON.parse(caseBytes.toString()).slice(0,o.limit??100);
 if(!cases.length||cases.length>100||new Set(cases.map((j:any)=>j.url)).size!==cases.length||cases.some((j:any)=>!Array.isArray(j.gold)||!j.gold.length))throw Error('FIXED_GOLD_CASES_REQUIRED');
 const report:any={scope:'actual App background Pi Agent; live qwen-flash API; frozen ordinary-draft tasks',status:'preparing',
  taskDefinition:'read confirmed fact keys, inspect real form, model chooses mappings and calls fill tool, then read back; do not guess/upload/submit',
  primaryCompletion:'Agent protocol completed plus all fixed contact gold correct, no unsupported-field writes, no executor failure, no final selected declaration/file',
  wholeApplicationCompletion:'not evaluated; uploads, missing personal facts and unsupported controls can remain',
  baselineMeaning:'frozen initial model-Agent prototype before semantic-guard and readiness repair; not an old shipped model Agent',baseline:baselineManifest,
  samePromptToolsModelBudgets:true,perTaskBudget:{modelRequests:6,toolCalls:10,timeoutMs:90000,maxOutputTokensPerRequest:1800},
  model:'qwen-flash',caseCount:cases.length,caseSHA256:hash(caseBytes),normalUserDataUsed:false,submitted:false,uploads:false,
  startedAt:new Date().toISOString(),arms:[],modelAttempts:[],networkBlocked:{},modelKeyPersisted:false};
 async function save(){const path=join(o.directory,'progress.json');await writeFile(path+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(path+'.tmp',path);}
 await save();
 const s0=await o.methods.getState!();if(s0.profile.version!==0||s0.jobs.length)throw Error('EMPTY_QA_STATE_REQUIRED');
 const imported=await readResume(o.resumePath);let state=await o.methods.saveProfile!({...inputProfile(s0.profile),...imported.suggested,fullNameEn:'OfferFlash QA',
  school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',career:imported.career,resumeText:imported.text},0);
 for(const collection of ['educations','internships','projects','publications'])for(const r of [...state.profile.career[collection]])state=await o.methods.confirmCareerRecord!(collection,r.id,state.profile.version,r.revision);
 const career=pickCareerInput(state.profile.career);career.primaryEducationId=career.educations.find(e=>e.school==='虚构海港大学')?.id??null;
 state=await o.methods.saveProfile!({...inputProfile(state.profile),career},state.profile.version);
 for(const [i,j] of cases.entries())await o.methods.saveJob!({id:'agent-bench-'+i,company:j.company,title:j.title,url:j.url,type:'unknown',city:'',requirements:'',description:'',sourceId:'agent-bench-public',sourceName:'公开官网后台Agent测评',publishedAt:null,deadline:null,demo:false});
 process.stdout.write('BACKGROUND_AGENT_BENCH_KEY_STDIN_READY\n');
 let credential=await readBenchmarkCredential(process.stdin,{timeoutMs:600000});
 try{await o.methods.configureModel!({mode:'live',provider:'custom',modelId:'qwen-flash',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:credential});}finally{credential='';}
 const provider=o.getProvider();if(!provider)throw Error('LIVE_BACKGROUND_AGENT_REQUIRED');
 report.status='running';await save();
 const runId=randomUUID().slice(0,8);
 const selectedArms=o.armIds?arms.filter(a=>o.armIds!.includes(a.id)):arms;
 if(!selectedArms.length||o.armIds&&o.armIds.length!==selectedArms.length)throw Error('INVALID_BENCHMARK_ARMS');
 report.requestedArms=selectedArms.map(a=>a.id);
 for(const arm of selectedArms){
  if(provider.isBlocked()){report.status='blocked-model-service-or-budget';break;}
  const result:any={...arm,startedAt:new Date().toISOString(),status:'running',results:[],peakActivePages:0};report.arms.push(result);
  const partition=`offerflash-agent-bench-${runId}-${arm.id}`,browserSession=session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_w,_p,done)=>done(false));
  browserSession.webRequest.onBeforeRequest((d,done)=>{const allowed=qaRequestAllowed(d);if(!allowed)report.networkBlocked[d.method]=(report.networkBlocked[d.method]??0)+1;done({cancel:!allowed});});
  o.queue.setBenchmarkContext(arm.variant,partition,arm.variant==='baseline'?frozenBaseline.runBackgroundFormAgent:undefined);const armStart=performance.now();
  for(let offset=0;offset<cases.length;offset+=5){
    if(provider.isBlocked()){result.status='blocked-model-service-or-budget';break;}
    const group=cases.slice(offset,offset+5),jobIds=group.map((_:any,i:number)=>'agent-bench-'+(offset+i));
    const start=performance.now();const queued=await o.methods.enqueueApplications!({jobIds,profileVersion:state.profile.version,acknowledgeAutosave:true,useModel:true,concurrency:arm.concurrency});
    await o.methods.startApplicationQueue!();let lastPrint=0;const deadline=Date.now()+650000;
    while(o.queue.hasPendingMutation()){
      result.peakActivePages=Math.max(result.peakActivePages,o.queue.state().activeItemIds?.length??0);
      if(Date.now()>deadline){await o.queue.cancel();break;}
      if(Date.now()-lastPrint>10000){lastPrint=Date.now();process.stdout.write(JSON.stringify({arm:arm.id,completed:result.results.length,
        active:o.queue.state().activeItemIds?.length??0,realModelRequests:provider.attempts.length})+'\n');report.modelAttempts=provider.attempts;await save();}
      await delay(100);
    }
    const batchMs=performance.now()-start;
    for(const [i,job] of group.entries()){
      const item=o.queue.state().items.find(x=>x.jobId===jobIds[i]);const audit:any=item?await o.queue.qaEvidence(item.id):null;
      await delay(400);const later:any=item?await o.queue.qaEvidence(item.id):null;
      const before=audit?.before?.observation?.fields??[],after=later?.after?.observation?.fields??[];
      const gold=auditGold(job,before,after),evidence=audit?.agent;
      const negatives=new Set(job.mustRemainBlank??[]),forbiddenWrites=(audit?.writeStatuses??[]).filter((w:any)=>w.status==='written'&&negatives.has(normalized(w.label??'')));
      const protectedFinal=later?.after?.protected??[];
      const selected=protectedFinal.some((p:any)=>p.checked||p.files>0);
      const protocolComplete=evidence?.status==='completed'&&evidence.modelCalls>0&&evidence.fillCalls>0&&evidence.statusReads>0;
      const success=!!(protocolComplete&&!evidence.failure&&gold.correct===gold.eligible&&gold.eligible>0&&!selected&&!forbiddenWrites.length);
      const entry={company:job.company,url:job.url,provider:job.provider,taskId:evidence?.taskId??null,status:success?'completed':'incomplete',
        failure:!audit?'page-load-or-read-failed':forbiddenWrites.length?'unsupported-field-written':!protocolComplete?evidence?.failure??'agent-protocol-incomplete':evidence.failure??(gold.correct!==gold.eligible?'gold-contact-mismatch':selected?'protected-control-changed':null),
        gold,protocolComplete,executorVerified:evidence?.verified??0,inspections:evidence?.inspections??0,fillToolCalls:evidence?.fillCalls??0,
        statusReads:evidence?.statusReads??0,writeAttempts:evidence?.writeAttempts??0,finalCheckedOrFiles:selected,batchMs,
        forbiddenWriteCount:forbiddenWrites.length,rejectedMappings:evidence?.rejectedMappings??0,
        durationMs:item?.durationMs??null,queueLatencyMs:item?.finishedAt&&item.enqueuedAt?Date.parse(item.finishedAt)-Date.parse(item.enqueuedAt):null,
        toolNames:evidence?.events.filter((e:any)=>e.type==='tool_started').map((e:any)=>e.data.toolName)??[]};
      await writeFile(join(o.directory,`${arm.id}-${offset+i}.private.json`),JSON.stringify({audit,later,entry},null,2),{mode:0o600});
      result.results.push(entry);if(item)o.queue.close(item.id);
    }
    report.modelAttempts=provider.attempts;await save();o.notify(`${arm.id} ${result.results.length}/${cases.length}，真实API ${provider.attempts.length}次`);
  }
  result.wallMs=performance.now()-armStart;result.finishedAt=new Date().toISOString();if(result.status==='running')result.status='completed';
  result.completedTasks=result.results.filter((r:any)=>r.status==='completed').length;
  result.completionRate=result.results.length?result.completedTasks/result.results.length:0;
  result.throughputPerMinute=result.results.length/(result.wallMs/60000);
  result.failureCounts={};for(const r of result.results)if(r.failure)result.failureCounts[r.failure]=(result.failureCounts[r.failure]??0)+1;
  await save();
 }
 report.status=report.arms.length===selectedArms.length&&report.arms.every((a:any)=>a.status==='completed'&&a.results.length===cases.length)?'completed':'incomplete';
 report.finishedAt=new Date().toISOString();report.modelAttempts=provider.attempts;await save();return report;
}
