import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../packages/domain/src/store.js';
import {collectionOptions,validateCollectionReport} from '../packages/shared/src/source-collection.js';
import {persistSourceCollection} from '../packages/sources/src/persist.js';
import type {JobInput,SourceCollectionReport,SourceRun} from '../packages/shared/src/contracts.js';
const job=(id='1'):JobInput=>({id:`tencent-${id}`,company:'虚构采集企业',title:'算法岗位（虚构）',city:'杭州',type:'experienced',description:'列表摘要',requirements:'',url:`https://careers.tencent.com/jobdesc.html?postId=${id}`,sourceId:'tencent-experienced',sourceName:'腾讯经验接口（虚构响应）',observedAt:'2026-10-12T01:00:00Z',publishedAt:null,deadline:null,demo:false});
const report=(n=1):SourceCollectionReport=>({schemaVersion:1,status:'partial',query:{keyword:'算法',pageSize:20,maxPages:2,detailLimit:0},scope:{mode:'official-api-pages',listURL:'https://careers.tencent.com/tencentcareer/api/post/Query',description:'仅虚构响应的前两页'},pagesRequested:2,pagesSucceeded:1,officialTotal:50,listedCount:n,detailRequested:0,detailSucceeded:0,detailFailed:0,detailResults:[],stopReason:'request-failed',errors:[{stage:'list',pageIndex:2,code:'HTTP_ERROR',message:'虚构HTTP503'}]});
const run=(id:string,r=report()):SourceRun=>({id,sourceId:'tencent-experienced',sourceName:'腾讯经验接口（虚构响应）',status:r.status,count:r.listedCount,observedAt:'2026-10-12T01:00:00Z',report:r});
async function fixture(work:(s:Awaited<ReturnType<typeof createStore>>,directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'offeragent-source-store-'));const s=await createStore({directory});try{await work(s,directory)}finally{await s.close();await rm(directory,{recursive:true,force:true})}}

test('collection budgets and report claims cannot exceed their evidence',()=>{
 for(const value of [{maxPages:11},{detailLimit:-1},{pageSize:51},{scope:'all-sites'},{token:'fixture'}])assert.throws(()=>collectionOptions(value));
 assert.throws(()=>validateCollectionReport({...report(),status:'success'}));
 assert.throws(()=>validateCollectionReport({...report(),pagesSucceeded:3}));
 assert.throws(()=>validateCollectionReport({...report(),detailRequested:1}));
 assert.throws(()=>validateCollectionReport({...report(),newCount:1,updatedCount:1}));
 assert.throws(()=>validateCollectionReport({...report(),scope:{...report().scope,listURL:'https://user:secret@careers.tencent.com/'}}));
 assert.equal(validateCollectionReport(report()).status,'partial');
});

test('partial and cancelled collections persist jobs and their report in one operation',async()=>fixture(async s=>{
 let state=await persistSourceCollection(s,{jobs:[job()],report:report()},{id:'tencent-experienced',name:'虚构采集'});
 assert.equal(state.jobs.length,1);assert.equal(state.sourceRuns[0]!.status,'partial');assert.equal(state.sourceRuns[0]!.report!.newCount,1);
 const cancelled={...report(),stopReason:'aborted' as const,errors:[{stage:'list' as const,code:'ABORTED',message:'虚构取消'}]};
 state=await persistSourceCollection(s,{jobs:[job('2')],report:cancelled},{id:'tencent-experienced',name:'虚构采集'});
 assert.equal(state.jobs.length,2);assert.ok(state.sourceRuns.some(r=>r.report?.stopReason==='aborted'));
}));

test('duplicate run conflicts roll back its jobs, preserving the original report',async()=>fixture(async s=>{
 await s.importCollectedJobs([job()],run('stable-run'));
 await assert.rejects(s.importCollectedJobs([job('2')],run('stable-run')),/ID/);
 const state=await s.getState();assert.deepEqual(state.jobs.map(j=>j.id),['tencent-1']);assert.equal(state.sourceRuns.length,1);
 await assert.rejects(s.importCollectedJobs([job(),job()],run('duplicates',report(2))),/重复/);
 await assert.rejects(s.importCollectedJobs([job('3')],run('wrong-count',report(2))),/一致/);
 assert.equal((await s.getState()).jobs.length,1);
}));

test('list-only refresh preserves prior detail, first discovery and application progress',async()=>fixture(async s=>{
 const full={...job(),description:'此前已读的完整职责',requirements:'此前已读的完整任职要求'};
 const completed={...report(),query:{...report().query,detailLimit:1},detailRequested:1,detailSucceeded:1,detailResults:[{jobURL:job().url,status:'success' as const}]};
 await s.importCollectedJobs([full],run('original-detail',completed));await s.trackJob('tencent-1');
 const app=(await s.getState()).applications[0]!;
 await s.saveApplication({id:app.id,jobId:app.jobId,company:app.company,title:app.title,url:app.url,deadline:app.deadline,status:'interview',notes:'用户自行维护的进度'});
 const before=await s.getState();
 const after=await s.importCollectedJobs([{...job(),observedAt:'2026-10-12T02:00:00Z'}],run('list-refresh'));
 assert.equal(after.jobs[0]!.description,full.description);assert.equal(after.jobs[0]!.requirements,full.requirements);
 assert.equal(after.jobs[0]!.firstSeenAt,before.jobs[0]!.firstSeenAt);assert.deepEqual(after.applications,before.applications);
 assert.equal(after.sourceRuns.find(r=>r.id==='list-refresh')!.report!.newCount,0);assert.equal(after.sourceRuns.find(r=>r.id==='list-refresh')!.report!.updatedCount,0);
}));

test('list-only candidates can receive newer summaries without invented detail evidence',async()=>fixture(async s=>{
 await s.importCollectedJobs([job()],run('first-list'));
 const changed={...job(),description:'官网更新后的列表职责',requirements:'更新后的经验条件'};
 const state=await s.importCollectedJobs([changed],run('newer-list'));
 assert.equal(state.jobs[0]!.description,changed.description);assert.equal(state.jobs[0]!.requirements,changed.requirements);
 assert.equal(state.jobs[0]!.detailEvidence,undefined);assert.equal(state.sourceRuns.find(r=>r.id==='newer-list')!.report!.updatedCount,1);
}));

test('collection cannot bind foreign URLs or overwrite another source through a shared id',async()=>fixture(async s=>{
 await s.saveJob(job());
 await assert.rejects(s.importCollectedJobs([{...job(),url:'https://join.qq.com/post.html?id=1'}],run('foreign')),/同源/);
 await assert.rejects(s.importCollectedJobs([{...job(),sourceId:'other'}],run('wrong-source')),/真实来源/);
 await assert.rejects(s.importCollectedJobs([{...job(),url:job('2').url}],run('wrong-id')),/ID/);
 assert.equal((await s.getState()).jobs.length,1);assert.equal((await s.getState()).sourceRuns.length,0);
}));

test('successful per-job detail replaces old content while new count remains zero',async()=>fixture(async s=>{
 await s.saveJob({...job(),description:'旧完整职责',requirements:'旧要求'});
 const r={...report(),query:{...report().query,detailLimit:1},detailRequested:1,detailSucceeded:1,detailResults:[{jobURL:job().url,status:'success' as const}]};
 const state=await s.importCollectedJobs([{...job(),description:'新完整职责',requirements:'新要求'}],run('detail-refresh',r));
 assert.equal(state.jobs[0]!.description,'新完整职责');assert.equal(state.sourceRuns[0]!.report!.updatedCount,1);assert.equal(state.sourceRuns[0]!.report!.newCount,0);
 const unknown={...r,detailResults:[{jobURL:job('9').url,status:'success' as const}]};
 await assert.rejects(s.importCollectedJobs([job()],run('not-listed',unknown)),/对应/);
}));

test('concurrent refreshes count first discovery once and persist across reopening',async()=>fixture(async(s,directory)=>{
 const results=await Promise.all([s.importCollectedJobs([job()],run('run-a')),s.importCollectedJobs([job()],run('run-b'))]);
 const state=results[1]!;assert.equal(state.jobs.length,1);assert.equal(state.sourceRuns.reduce((n,r)=>n+(r.report?.newCount??0),0),1);
 await s.close();const reopened=await createStore({directory});try{const saved=await reopened.getState();assert.equal(saved.jobs.length,1);assert.equal(saved.sourceRuns.length,2)}finally{await reopened.close()}
}));

test('complete empty official result is distinguishable from a failed request',async()=>fixture(async s=>{
 const empty={...report(0),status:'success' as const,pagesRequested:1,pagesSucceeded:1,officialTotal:0,stopReason:'empty-page' as const,errors:[]};
 let state=await s.importCollectedJobs([],run('empty',empty));assert.equal(state.sourceRuns[0]!.status,'success');
 const failed={...report(0),status:'failed' as const,pagesSucceeded:0};
 state=await persistSourceCollection(s,{jobs:[],report:failed},{id:'tencent-experienced',name:'虚构采集'});
 assert.ok(state.sourceRuns.some(r=>r.status==='failed'&&r.error?.includes('503')));
}));

test('unknown fresh dates retain prior recorded dates rather than erase them',async()=>fixture(async s=>{
 await s.saveJob({...job(),publishedAt:'2026-10-01',deadline:'2026-11-01'});
 const r={...report(),query:{...report().query,detailLimit:1},detailRequested:1,detailSucceeded:1,detailResults:[{jobURL:job().url,status:'success' as const}]};
 const state=await s.importCollectedJobs([job()],run('date-unknown',r));
 assert.equal(state.jobs[0]!.publishedAt,'2026-10-01');assert.equal(state.jobs[0]!.deadline,'2026-11-01');
 assert.equal(state.sourceRuns[0]!.report!.newCount,0);
}));

test('changing a saved job source or URL cannot inherit another detail identity',async()=>fixture(async s=>{
 const completed={...report(),query:{...report().query,detailLimit:1},detailRequested:1,detailSucceeded:1,detailResults:[{jobURL:job().url,status:'success' as const}]};
 await s.importCollectedJobs([job()],run('read-detail',completed));
 let state=await s.saveJob({...job(),url:job('2').url});assert.equal(state.jobs[0]!.detailEvidence,undefined);
 await s.saveJob(job());
 await s.importCollectedJobs([job()],run('read-again',completed));
 state=await s.saveJob({...job(),sourceId:'manual',sourceName:'用户重新指定的来源'});assert.equal(state.jobs[0]!.detailEvidence,undefined);
}));
