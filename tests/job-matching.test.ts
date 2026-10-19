import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{parseEvidenceRanking,buildJobMatchingInput,hardGateMatching,parseJobMatchingRanking,matchJobsWithModel,matchingInputHash}from'../packages/agent/src/job-matching.js';
import{JobMatchingService}from'../apps/desktop/job-matching-service.js';import{modelMatchedJobs}from'../packages/ui/src/job-matching.js';import type{AppState}from'../packages/shared/src/contracts.js';
const data=()=>readFile('benchmarks/offerflash-v1/matching.json','utf8').then(JSON.parse);
async function world(){const d=await data(),profile=structuredClone(d.personas[0].profile);return {profile,jobs:d.jobs.filter((j:any)=>j.split==='dev').map((e:any)=>({...e.job,demo:false,firstSeenAt:e.job.observedAt,match:{score:20,reasons:[],concerns:[],eligible:'review',profileVersion:profile.version}})),applications:[],sourceRuns:[],settings:{showDemo:false}}as AppState;}
test('production matching projection excludes contacts/source/raw resume and all unconfirmed descriptions',async()=>{
 const s=await world();s.profile.fullName='PRIVATE_NAME';s.profile.email='private@example.invalid';s.profile.resumeText='PRIVATE_RAW';s.profile.career!.projects.push({...s.profile.career!.projects[0]!,id:'unconfirmed',description:'PRIVATE_UNCONFIRMED',confirmation:'pending',confirmedRevision:null});
 const input=buildJobMatchingInput(s.profile,s.jobs,'2026-10-19T00:00:00Z',{includeCareerDetails:true});const text=JSON.stringify(input);for(const marker of ['PRIVATE','email','resumeText','sourceNote'])assert.ok(!text.includes(marker));assert.ok(input.cv.projects[0]!.description.includes('Python'));
 assert.equal(buildJobMatchingInput(s.profile,s.jobs,'2026-10-19',{includeCareerDetails:false}).cv.projects[0]!.description,'');
});
test('existing hard gate is applied before the improved model and rechecked after validated IDs',async()=>{
 const s=await world(),input=buildJobMatchingInput(s.profile,s.jobs,'2026-10-19',{includeCareerDetails:true,preferences:{region:'mainland',acceptedRecruitmentTypes:['campus']}});const eligible=hardGateMatching(input);let count=0;
 const runtime={completeSimple:async(_m:any,ctx:any,opts:any)=>{count++;const sent=JSON.parse(ctx.messages[0].content);assert.deepEqual(sent.jobs.map((j:any)=>j.id),eligible);assert.deepEqual(ctx.tools,[]);assert.equal(opts.maxTokens,1000);assert.equal(opts.maxRetries,0);return {stopReason:'stop',content:[{type:'text',text:JSON.stringify({ranking:[eligible[0]],evidence:[{id:eligible[0],cvEvidenceId:'c0',jobEvidenceId:'d0'}]})}],usage:{input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15}};}};
 const result=await matchJobsWithModel(runtime as any,{id:'fixture'}as any,input);assert.equal(count,1);assert.deepEqual(result.ranking,[eligible[0]]);assert.equal(result.inputHash,matchingInputHash(input));
 const bad=async()=>matchJobsWithModel({completeSimple:async()=>({stopReason:'stop',content:[{type:'text',text:'{"ranking":["invented"]}'}],usage:{}})}as any,{}as any,input);await assert.rejects(bad);
});
test('empty candidate pool abstains with zero calls; invalid/duplicate IDs and added model facts are rejected',async()=>{
 const s=await world(),input=buildJobMatchingInput(s.profile,[],'2026-10-19',{includeCareerDetails:false});let calls=0;const r=await matchJobsWithModel({completeSimple:async()=>{calls++;}}as any,{id:'fixture'}as any,input);assert.equal(calls,0);assert.equal(r.attempt.attempted,false);
 for(const raw of ['{"ranking":["x","x"]}','{"ranking":["x"],"score":100}','{"ranking":["bad"]}'])assert.throws(()=>parseJobMatchingRanking(raw,['x']));
});
test('host publishes exact model order and explicit empty result without modifying business state',async()=>{
 const s=await world(),before=JSON.stringify(s);let modelOrder:string[]|undefined;const service=new JobMatchingService({getState:async()=>s,now:()=>new Date('2026-10-19'),onState(){},runModel:async(input)=>({ranking:modelOrder??[input.jobs[1]!.id!,input.jobs[0]!.id!],rawRanking:[],eligibleIds:input.jobs.map(j=>j.id!),inputHash:matchingInputHash(input),variant:'evidence-pre-post-gate',modelId:'fixture',attempt:{attempted:true,stopReason:'stop',durationMs:1,usage:null}})});
 const result=await service.run({expectedVersion:s.profile.version,jobIds:s.jobs.slice(0,2).map(j=>j.id),includeCareerDetails:true});assert.deepEqual(modelMatchedJobs(s,result)?.map(j=>j.id),result.ranking);assert.equal(JSON.stringify(s),before);
 modelOrder=[];const empty=await service.run({expectedVersion:s.profile.version,jobIds:s.jobs.slice(0,2).map(j=>j.id),includeCareerDetails:true});assert.deepEqual(modelMatchedJobs(s,empty),[],'empty model result never falls back to a rule list');
 s.profile.version++;assert.equal(modelMatchedJobs(s,result),undefined);assert.equal((await service.state()).status,'stale');
});
test('profile/content changes during inference reject late results and do not grant a tracker or browser action',async()=>{
 for(const mode of ['profile','content']){const s=await world();const service=new JobMatchingService({getState:async()=>s,onState(){},runModel:async input=>{if(mode==='profile')s.profile.version++;else s.jobs[0]!.requirements+=' changed';return {ranking:[input.jobs[0]!.id!],rawRanking:[],eligibleIds:[],inputHash:matchingInputHash(input),variant:'evidence-pre-post-gate',modelId:'fixture',attempt:{attempted:true,stopReason:'stop',durationMs:1,usage:null}};}});
 await assert.rejects(service.run({expectedVersion:s.profile.version,jobIds:[s.jobs[0]!.id],includeCareerDetails:true}));assert.deepEqual((await service.state()).ranking,[]);assert.equal(s.applications.length,0);}
});
test('cancellation holds the busy lock until the actual read-only provider settles',async()=>{
 const s=await world();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),pending=new Promise<void>(r=>release=r);
 const service=new JobMatchingService({getState:async()=>s,onState(){},runModel:async input=>{started();await pending;return {ranking:[],rawRanking:[],eligibleIds:[],inputHash:matchingInputHash(input),variant:'evidence-pre-post-gate',modelId:'fixture',attempt:{attempted:true,stopReason:'stop',durationMs:1,usage:null}};}});
 const run=service.run({expectedVersion:s.profile.version,jobIds:[s.jobs[0]!.id],includeCareerDetails:false});await entered;const cancelling=service.cancel();assert.equal(service.isRunning(),true);release();await assert.rejects(run);await cancelling;assert.equal(service.isRunning(),false);assert.equal((await service.state()).status,'cancelled');
});
test('evidence IDs resolve only to provided positive CV facts and that exact job duty',async()=>{
 const s=await world(),input=buildJobMatchingInput(s.profile,[s.jobs[0]!],'2026-10-19',{includeCareerDetails:true});
 const good={ranking:[input.jobs[0]!.id],evidence:[{id:input.jobs[0]!.id,cvEvidenceId:'c0',jobEvidenceId:'d0'}]};
 const parsed=parseEvidenceRanking(JSON.stringify(good),input);assert.equal(parsed.ranking.length,1);assert.equal(parsed.proofs[input.jobs[0]!.id!]!.cvQuote,input.cv.skills[0]);
 const bad=structuredClone(good);bad.evidence[0]!.cvEvidenceId='invented';const rejected=parseEvidenceRanking(JSON.stringify(bad),input);assert.equal(rejected.ranking.length,0);assert.equal(rejected.rejected.length,1);
 input.jobs[0]!.id='toString';const polluted={ranking:['toString'],evidence:[{id:'toString',cvEvidenceId:'invented',jobEvidenceId:'d0'}]};assert.deepEqual(parseEvidenceRanking(JSON.stringify(polluted),input).ranking,[]);
});
test('whole-library retrieval excludes explicit hard conflicts before spending reranker context',async()=>{
 const s=await world();s.jobs=s.jobs.slice(0,2);s.jobs[1]!.requirements='2027届，必须博士学历';let sent:string[]=[];
 const service=new JobMatchingService({getState:async()=>s,now:()=>new Date('2026-10-19'),onState(){},runModel:async input=>{sent=input.jobs.map(j=>j.id!);return {ranking:[input.jobs[0]!.id!],rawRanking:[],eligibleIds:[],inputHash:matchingInputHash(input),variant:'baseline-post-gate',modelId:'fixture',attempt:{attempted:true,stopReason:'stop',durationMs:1,usage:null}};}});
 await service.run({expectedVersion:s.profile.version,includeCareerDetails:false});assert.equal(sent.length,1);assert.ok(!sent.includes(s.jobs[1]!.id));assert.equal((await service.state()).retrieval?.scannedCount,2);
});
test('cached model selection expires with the original deadline policy instead of surviving midnight',async()=>{
 const s=await world();s.jobs=s.jobs.slice(0,1);s.jobs[0]!.deadline='2026-10-19';let now=new Date('2026-10-19T00:00:00Z');
 const service=new JobMatchingService({getState:async()=>s,now:()=>now,onState(){},runModel:async input=>({ranking:[input.jobs[0]!.id!],rawRanking:[],eligibleIds:[],inputHash:matchingInputHash(input),variant:'baseline-post-gate',modelId:'fixture',attempt:{attempted:true,stopReason:'stop',durationMs:1,usage:null}})});
 await service.run({expectedVersion:s.profile.version,includeCareerDetails:false});now=new Date('2026-10-20T00:00:00Z');assert.equal((await service.state()).status,'stale');assert.equal(s.applications.length,0);
});
