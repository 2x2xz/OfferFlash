/** Observation and network protection for the full application QA instance.
 * This module never drives the renderer or writes into an employer's page. */
import {mkdir, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Session} from 'electron';
export interface QAObservation {url:string;fields:Array<{index:number;value:string;[key:string]:unknown}>;}

export function qaRequestAllowed(input: {url:string; method:string; resourceType?:string}): boolean {
  let url:URL; try {url=new URL(input.url);} catch {return false;}
  if (url.protocol==='data:') return ['image','font'].includes(input.resourceType??'');
  if (url.protocol!=='https:' || url.username || url.password || url.port) return false;
  if (!['GET','HEAD'].includes(input.method)) return false;
  // Test contact data must not escape through a GET query either.
  let query=url.search;try {query=decodeURIComponent(query);} catch {return false;}
  return !/example\.invalid|offerflash[ +_-]*(?:qa|validation)|202[ -]?555[ -]?01/i.test(query);
}

const observedMethods=new Set(['importResume','saveProfile','confirmCareerRecord','discoverJobs','saveJob','trackJob',
  'browserNavigate','capturePage','collectPageJobs','prepareFill','fillApproved','prepareCareerFill','runCareerFill',
  'refreshApplicationAttention','runAgent','beginMeasurement','finishMeasurement','enqueueApplications','startApplicationQueue']);
const withoutValues=(fields:QAObservation['fields'])=>fields.map(({value,...field})=>field);

/** Wrap the normal IPC handlers; there is no alternative execution path or fake result. */
export async function installRealSiteQA(options:{directory:string; session:Session;
  methods:Record<string,(...args:any[])=>Promise<any>>; observe:()=>Promise<QAObservation>;
  telemetry:()=>Promise<unknown>}) {
  await mkdir(options.directory,{recursive:true,mode:0o700});
  const events:any[]=[], blocked:Record<string,number>={};
  let order=0, pending=Promise.resolve(), lastPlan:any, auditFailed=false;
  const persist=()=>{
    const snapshot={version:1,scope:'full-production-application-observation',normalUserDataUsed:false,
      automatedUIDriver:false,submissionProtection:'employer-session GET/HEAD only; WebSocket and other methods blocked',
      applicationSubmissionAcceptanceClaim:false,semanticAccuracyClaim:false,blockedMethods:{...blocked},events:structuredClone(events)};
    pending=pending.then(async()=>{const path=join(options.directory,'app-qa-progress.json');await writeFile(path+'.tmp',JSON.stringify(snapshot,null,2),{mode:0o600});await rename(path+'.tmp',path);});
    return pending;
  };
  options.session.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=qaRequestAllowed(details);if(!allowed)blocked[details.method]=(blocked[details.method]??0)+1;
    callback({cancel:!allowed});
  });
  options.session.on('will-download',event=>event.preventDefault());
  for(const name of observedMethods){
    const original=options.methods[name];if(!original)continue;
    options.methods[name]=async(...args:any[])=>{
      if(auditFailed&&['fillApproved','runCareerFill','enqueueApplications','startApplicationQueue'].includes(name))throw new Error('测评独立核对不可用，已停止后续填写。');
      const id=++order, startedAt=new Date().toISOString(),start=performance.now();
      let result:any;
      try {result=await original(...args);} catch(error){
        events.push({id,method:name,startedAt,durationMs:performance.now()-start,status:'failed',errorName:error instanceof Error?error.name:'UnknownError'});
        await persist();throw error;
      }
      const event:any={id,method:name,startedAt,durationMs:performance.now()-start,status:'returned'};
      try{
      if(name==='prepareFill'){
        lastPlan=structuredClone(result);
        const observation=await options.observe();
        await writeFile(join(options.directory,`observation-${id}.private.json`),JSON.stringify({observation,plan:result},null,2),{mode:0o600});
        event.fieldCount=observation.fields.length;event.fields=withoutValues(observation.fields);event.planCounts=Object.fromEntries(['ready','review','skip'].map(status=>[status,result.items.filter((i:any)=>i.status===status).length]));
      }
      if(name==='fillApproved'){
        const after=await options.observe();
        await writeFile(join(options.directory,`readback-${id}.private.json`),JSON.stringify({after,result},null,2),{mode:0o600});
        const selected=Array.isArray(args[1])?args[1]:[];
        event.planIdMatched=lastPlan?.id===args[0];event.selectedCount=selected.length;
        event.executorVerifiedCount=result.verified?.length??0;event.unresolvedCount=result.unresolved?.length??0;
        // This is execution consistency with an approved plan, not independently labelled semantic accuracy.
        event.approvedValueReadback=selected.map((fieldId:string)=>{
          const item=lastPlan?.items.find((i:any)=>i.fieldId===fieldId);
          const field=after.fields.find(f=>`field-${f.index}`===fieldId);
          return {fieldId,exists:!!field,exactMatch:!!(item&&field&&item.value===field.value)};
        });
      }
      if(name==='finishMeasurement')await writeFile(join(options.directory,`telemetry-${randomUUID()}.private.json`),JSON.stringify(await options.telemetry(),null,2),{mode:0o600});
      }catch{auditFailed=true;event.status='audit-failed-after-return';event.independentAuditAvailable=false;}
      events.push(event);await persist();return result;
    };
  }
  await persist();
  return {flush:persist};
}
