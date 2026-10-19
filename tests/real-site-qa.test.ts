import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {qaRequestAllowed,installRealSiteQA} from '../apps/desktop/real-site-qa.js';

test('real employer test session rejects submission, autosave, websocket, insecure destinations and test data in GET',()=>{
  assert.equal(qaRequestAllowed({url:'https://jobs.lever.co/company/id/apply',method:'GET'}),true);
  assert.equal(qaRequestAllowed({url:'https://job-boards.greenhouse.io/company/jobs/123',method:'HEAD'}),true);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(qaRequestAllowed({url:'https://jobs.lever.co/company/id',method}),false);
  for(const url of ['http://jobs.lever.co/company','wss://jobs.lever.co/save','https://user:pass@jobs.lever.co/a','https://jobs.lever.co/a?email=qa%40example.invalid','https://jobs.lever.co/a?phone=2025550100','https://jobs.lever.co/a?name=OfferFlash%20QA','https://jobs.lever.co/a?bad=%xx'])assert.equal(qaRequestAllowed({url,method:'GET'}),false);
  assert.equal(qaRequestAllowed({url:'data:image/png;base64,AA',method:'GET',resourceType:'image'}),true);
  assert.equal(qaRequestAllowed({url:'data:text/html,hello',method:'GET',resourceType:'mainFrame'}),false);
});

async function harness(work:(v:{directory:string;methods:any;network:(d:any,c:any)=>void;download:()=>boolean;flush:()=>Promise<void>;setObservation:(v:any)=>void})=>Promise<void>){
  const directory=await mkdtemp(join(tmpdir(),'offerflash-qa-audit-'));let network:any,download:any;
  let observation:any={url:'https://jobs.lever.co/fictional/id/apply',fields:[{index:0,label:'Name',type:'text',value:''}]};
  const methods:any={prepareFill:async()=>({id:'plan-a',items:[{fieldId:'field-0',value:'Fictional Candidate',status:'ready'}]}),
    fillApproved:async()=>({verified:[{fieldId:'field-0'}],unresolved:[]}),runAgent:async()=>{throw new Error('do not log secret-key-value');}};
  const observer=await installRealSiteQA({directory,methods,session:{webRequest:{onBeforeRequest:(cb:any)=>{network=cb;}},on:(name:string,cb:any)=>{if(name==='will-download')download=cb;}} as any,
    observe:async()=>{if(observation instanceof Error)throw observation;return observation;},telemetry:async()=>({resourceSpans:[]})});
  try{await work({directory,methods,network,download:()=>{let blocked=false;download({preventDefault:()=>{blocked=true;}});return blocked;},flush:observer.flush,setObservation:v=>{observation=v;}});}finally{await rm(directory,{recursive:true,force:true});}
}

test('normal production handlers execute once and independent final read can contradict a success receipt',async()=>harness(async h=>{
  await h.methods.prepareFill();await h.methods.fillApproved('plan-a',['field-0']);
  let report=JSON.parse(await readFile(join(h.directory,'app-qa-progress.json'),'utf8'));
  assert.equal(report.events[1].executorVerifiedCount,1);assert.equal(report.events[1].approvedValueReadback[0].exactMatch,false);
  h.setObservation({url:'https://jobs.lever.co/fictional/id/apply',fields:[{index:0,label:'Name',type:'text',value:'Fictional Candidate'}]});
  await h.methods.fillApproved('plan-a',['field-0']);report=JSON.parse(await readFile(join(h.directory,'app-qa-progress.json'),'utf8'));
  assert.equal(report.events[2].approvedValueReadback[0].exactMatch,true);assert.equal(report.semanticAccuracyClaim,false);
  assert.equal(JSON.stringify(report).includes('Fictional Candidate'),false);assert.equal(h.download(),true);
  let decision:any;h.network({url:'https://jobs.lever.co/submit',method:'POST'},(v:any)=>{decision=v;});assert.equal(decision.cancel,true);await h.flush();
  assert.equal(JSON.parse(await readFile(join(h.directory,'app-qa-progress.json'),'utf8')).blockedMethods.POST,1);
}));

test('failed independent audit stops new writes and does not replay a completed handler',async()=>harness(async h=>{
  h.setObservation(new Error('unavailable'));await h.methods.prepareFill();
  await assert.rejects(h.methods.fillApproved('plan-a',['field-0']),/独立核对/);
  const report=JSON.parse(await readFile(join(h.directory,'app-qa-progress.json'),'utf8'));assert.equal(report.events[0].status,'audit-failed-after-return');
}));

test('business failures remain failures without logging messages, arguments or credentials',async()=>harness(async h=>{
  await assert.rejects(h.methods.runAgent('secret-key-value'));
  const raw=await readFile(join(h.directory,'app-qa-progress.json'),'utf8');assert.equal(raw.includes('secret-key-value'),false);assert.equal(JSON.parse(raw).events[0].status,'failed');
}));
