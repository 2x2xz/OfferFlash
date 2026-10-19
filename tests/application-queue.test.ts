import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationFillQueue, BackgroundFillError, type BackgroundDraftPage } from '../packages/domain/src/application-queue.js';
import type { Profile } from '../packages/shared/src/contracts.js';

const profile = (): Profile => ({version:3,updatedAt:'2026-10-19T00:00:00Z',fullName:'虚构候选人',fullNameEn:'',email:'candidate@example.invalid',phone:'',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:''});
const target = (id: string) => ({jobId:id,company:`虚构公司${id}`,title:'虚构工程师',url:`https://example.invalid/${id}`});

test('queue enqueuing never opens websites; explicit start processes companies sequentially and never marks applied', async () => {
  const events: string[] = []; let active=0;
  const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async target=>{
    events.push(target.jobId);assert.equal(active,0);active++;
    return {dispose(){},async run(_profile,_signal,progress){progress(2,1);active--;return {verifiedCount:2,pendingCount:1,message:'还需人工核对',canReview:true};}};
  }});
  await queue.enqueue([target('a'),target('b')],3);assert.deepEqual(events,[]);assert.equal(queue.getState().status,'idle');
  await queue.startPrepared();await queue.settled();assert.deepEqual(events,['a','b']);
  assert.equal(queue.getState().status,'finished');assert.equal(queue.getState().completedCount,2);
  assert.deepEqual(queue.getState().items.map(item=>item.status),['waiting-user','waiting-user']);
  assert.ok(!JSON.stringify(queue.getState()).includes('applied'));queue.dispose();
});
test('a company needing login does not block the next company and private errors are never broadcast', async()=>{
  const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async target=>{
    if(target.jobId==='a')throw new Error('PRIVATE session=secret');
    return {dispose(){},async run(){return {verifiedCount:1,pendingCount:0,message:'已填普通字段，需检查',canReview:true};}};
  }});
  await queue.start([target('a'),target('b')],3);await queue.settled();
  assert.deepEqual(queue.getState().items.map(item=>item.status),['waiting-user','ready-for-review']);
  assert.ok(!JSON.stringify(queue.getState()).includes('PRIVATE'));assert.ok(!queue.getPage('unknown'));queue.dispose();
});
test('known failure guidance distinguishes changing pages from login without exposing arbitrary exception messages',async()=>{
  const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async()=>({dispose(){},async run(){
    const error=new BackgroundFillError('page-changing');error.message='PRIVATE injected detail';throw error;
  }})});
  await queue.start([target('a')],3);await queue.settled();
  const item=queue.getState().items[0]!;assert.match(item.message,/控件仍在变化/);assert.doesNotMatch(item.message,/PRIVATE|登录/);assert.equal(item.attention,'manual');queue.dispose();
});
test('profile change stops before the next company; resume cannot silently authorize a new version', async()=>{
  const p=profile(),opened:string[]=[];
  const queue=new ApplicationFillQueue({getProfile:async()=>structuredClone(p),createPage:async target=>{
    opened.push(target.jobId);return {dispose(){},async run(){p.version++;return {verifiedCount:1,pendingCount:0,message:'检查',canReview:true};}};
  }});
  await queue.start([target('a'),target('b')],3);await queue.settled();assert.deepEqual(opened,['a']);
  assert.equal(queue.getState().status,'paused');await assert.rejects(queue.resume(4),/资料版本已变化/);queue.dispose();
});
test('cancel aborts active task, retains its review draft, and never opens remaining companies', async()=>{
  const opened:string[]=[];let running!:()=>void;
  const began=new Promise<void>(resolve=>{running=resolve;});
  const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async target=>{
    opened.push(target.jobId);return {dispose(){},async run(_p,signal){running();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));throw new Error('cancel');}};
  }});
  await queue.start([target('a'),target('b')],3);await began;queue.cancel();await queue.settled();
  assert.deepEqual(opened,['a']);assert.equal(queue.getState().status,'cancelled');
  assert.equal(queue.getState().items[0]?.canReview,true);assert.equal(queue.getState().items[1]?.status,'cancelled');queue.dispose();
});
test('queue rejects unsafe targets, stale approval, duplicate jobs and oversized batches before opening', async()=>{
  let opened=0;const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async()=>{opened++;throw new Error();}});
  await assert.rejects(queue.start([target('a')],2),/资料已变化/);
  await assert.rejects(queue.start([{...target('a'),url:'http://example.invalid/a'}],3),/HTTPS/);
  await assert.rejects(queue.start([target('a'),target('a')],3),/不同岗位/);
  await assert.rejects(queue.start(Array.from({length:7},(_,i)=>target(String(i))),3),/1–6/);
  assert.equal(opened,0);queue.dispose();
});
test('state snapshots cannot change queue execution and next rounds retain earlier reviewable DOM', async()=>{
  const pages:BackgroundDraftPage[]=[];
  const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async()=>{const page={dispose(){},async run(){return {verifiedCount:0,pendingCount:1,message:'请登录',canReview:true};}};pages.push(page);return page;}});
  await queue.start([target('a')],3);await queue.settled();const old=queue.getState().items[0]!;
  const state=queue.getState();state.items[0]!.status='cancelled';assert.equal(queue.getState().items[0]!.status,'waiting-user');
  await queue.start([target('b')],3);await queue.settled();assert.equal(queue.getPage(old.id),pages[0]);assert.equal(queue.getState().items.length,2);
  await assert.rejects(queue.enqueue([target('a')],3),/已有保留草稿/);queue.dispose();
});
