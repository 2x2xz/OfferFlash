import test from 'node:test';
import assert from 'node:assert/strict';
import { jobSearchWorkflow } from '../packages/agent/src/job-search-workflow.js';
const result = { sourceRun: { count: 1, status: 'partial' }, discovery: { status: 'partial', sourcesAttempted: 2, completeDetails: 1, scopeNote: '仅公开推荐范围' },
  jobs: [{ title: '虚构算法实习', company: '虚构公司', url: 'https://example.invalid/job', city: '北京', match: { eligible: 'review' } }] };
test('the reported promise request executes real host steps once before returning bounded actual candidates', async () => {
  const calls: string[] = [], phases: string[] = [];
  const workflow = jobSearchWorkflow('能帮我查查适合我的岗位吗？', async (name, args) => {
    calls.push(name);
    if (name === 'get_profile_summary') return { version: 1 };
    assert.deepEqual(args, { sourceId: 'profile-discovery', region: 'mainland', maxPages: 2, pageSize: 20, detailLimit: 10 });
    return result;
  })!;
  const value = await workflow({ signal: new AbortController().signal, progress: phase => phases.push(phase) });
  assert.deepEqual(calls, ['get_profile_summary', 'refresh_jobs']);
  assert.deepEqual(phases, ['profile', 'search-mainland', 'results']);
  assert.match(value.summary, /1 条候选/); assert.match(value.summary, /部分范围/); assert.match(value.summary, /虚构算法/);
  assert.equal(value.status, 'completed'); assert.ok(!value.context.includes('fullName'));
});
test('a local-only request does not access any external source and excludes unsuitable/demo rows from displayed candidates', async () => {
  const calls: string[] = [];
  const workflow = jobSearchWorkflow('不要联网，帮我找本地岗位', async name => {
    calls.push(name); return name === 'get_profile_summary' ? { version: 1 }
      : { coverage: 'local-snapshot', totalMatched: 3, jobs: [...result.jobs, { title: 'bad', demo: true }, { title: 'bad2', match: { eligible: 'unsuitable' } }] };
  })!;
  const value = await workflow({ signal: new AbortController().signal, progress: () => {} });
  assert.deepEqual(calls, ['get_profile_summary', 'query_jobs']); assert.match(value.summary, /没有联网/); assert.match(value.summary, /展示 1 条/);
});
test('a source failure cannot become an empty successful search or fall back to old library jobs', async () => {
  let calls = 0;
  const workflow = jobSearchWorkflow('帮我找新岗位', async name => { calls++; return name === 'get_profile_summary' ? { version: 1 }
    : { ...result, jobs: [], sourceRun: { count: 0, status: 'failed' }, discovery: { status: 'failed', sourcesAttempted: 2 } }; })!;
  const value = await workflow({ signal: new AbortController().signal, progress: () => {} });
  assert.equal(value.status, 'failed'); assert.match(value.summary, /来源未完成/); assert.equal(calls, 2);
});
test('cancellation during profile reading prevents search and is propagated to the host signal', async () => {
  const controller = new AbortController(); let calls = 0;
  const workflow = jobSearchWorkflow('帮我找新岗位', async (_name, _args, signal) => { calls++; controller.abort(); assert.equal(signal?.aborted, true); return { version: 1 }; })!;
  const value = await workflow({ signal: controller.signal, progress: () => {} });
  assert.equal(calls, 1); assert.equal(value.status, 'cancelled');
});
test('chat model matching preserves returned order and does not report old rule candidates as model output',async()=>{
 const calls:string[]=[];const jobs=[0,1].map(i=>({id:'job-'+i,company:'虚构公司',title:'候选'+i,url:'https://example.invalid/'+i,city:'北京',match:{eligible:'review'},demo:false}));
 const workflow=jobSearchWorkflow('帮我找本地岗位',async(name,args)=>{calls.push(name);if(name==='get_profile_summary')return{version:2};if(name==='query_jobs'){assert.deepEqual(args,{limit:20});return{coverage:'local-snapshot',totalMatched:2,jobs};}assert.equal(name,'match_profile_jobs');return{status:'completed',profileVersion:2,ranking:['job-1']};},{modelMatching:true})!;
 const r=await workflow({signal:new AbortController().signal,progress(){}});assert.deepEqual(calls,['get_profile_summary','query_jobs','match_profile_jobs']);assert.deepEqual(JSON.parse(r.context).jobs.map((j:any)=>j.id),['job-1']);assert.match(r.summary,/模型保留1条/);assert.ok(!r.summary.includes('候选0'));
});
test('empty successful model shortlist stays empty and model failures explicitly retain rule-only status',async()=>{
 for(const fail of [false,true]){const workflow=jobSearchWorkflow('帮我找本地岗位',async name=>{if(name==='get_profile_summary')return{version:2};if(name==='query_jobs')return{coverage:'local-snapshot',totalMatched:1,jobs:[{id:'j',title:'规则候选',company:'虚构',url:'https://example.invalid/j',match:{eligible:'review'}}]};if(fail)throw Error('fixed');return{status:'completed',profileVersion:2,ranking:[]};},{modelMatching:true})!;
 const r=await workflow({signal:new AbortController().signal,progress(){}});assert.equal(JSON.parse(r.context).jobs.length,fail?1:0);assert.match(r.summary,fail?/仅保留规则候选/:/不凑数量/);}
});
test('chat can display a full-library hit outside the old query page without sending a truncated jobIds scope',async()=>{
 const winner={id:'after-100',company:'虚构公司',title:'完整库命中',url:'https://example.invalid/late',city:'北京',match:{eligible:'review'}};
 const workflow=jobSearchWorkflow('帮我在岗位库找大模型岗位',async(name,args:any)=>{if(name==='get_profile_summary')return{version:1};if(name==='query_jobs')return{coverage:'local-snapshot',totalMatched:104,jobs:[{...winner,id:'old-page',title:'旧首屏'}]};assert.equal(args.jobIds,undefined);assert.match(args.intent,/大模型/);return{status:'completed',profileVersion:1,ranking:[winner.id],jobs:[winner],retrieval:{scannedCount:104}};},{modelMatching:true})!;
 const r=await workflow({signal:new AbortController().signal,progress(){}});assert.match(r.summary,/104条记录中检索/);assert.match(r.summary,/完整库命中/);assert.ok(!r.summary.includes('旧首屏'));
});
test('an explicit offline request skips embedding and model matching even when online matching is configured',async()=>{const calls:string[]=[];const wf=jobSearchWorkflow('不要联网，帮我找本地岗位',async name=>{calls.push(name);return name==='get_profile_summary'?{version:1}:{coverage:'local-snapshot',totalMatched:0,jobs:[]};},{modelMatching:true})!;const r=await wf({signal:new AbortController().signal,progress(){}});assert.deepEqual(calls,['get_profile_summary','query_jobs']);assert.match(r.summary,/没有联网/);});
test('a generic find-suitable-jobs request keeps the saved professional direction instead of using the generic sentence as a new role',async()=>{let checked=false;const wf=jobSearchWorkflow('帮我找本地岗位',async(name,args:any)=>{if(name==='get_profile_summary')return{version:1,targetRoles:['大模型']};if(name==='query_jobs')return{coverage:'local-snapshot',totalMatched:1,jobs:[]};checked=true;assert.equal(args.intent,undefined);return{status:'completed',profileVersion:1,ranking:[],jobs:[]};},{modelMatching:true})!;await wf({signal:new AbortController().signal,progress(){}});assert.equal(checked,true);});
