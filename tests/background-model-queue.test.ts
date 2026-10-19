import assert from 'node:assert/strict';
import test from 'node:test';
import {ApplicationFillQueue} from '../packages/domain/src/application-queue.js';
import type {Profile} from '../packages/shared/src/contracts.js';
const profile=():Profile=>({version:1,updatedAt:'2026-10-19',fullName:'虚构',fullNameEn:'',email:'f@example.invalid',phone:'',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:''});
const targets=Array.from({length:5},(_,i)=>({jobId:String(i),company:'虚构'+i,title:'测试',url:'https://example.invalid/'+i}));
for(const concurrency of [1,3,5] as const)test(`queue enforces concurrency=${concurrency}, claims each task once and drains every worker`,async()=>{
 let active=0,peak=0,started=0,ready!:()=>void,release!:()=>void;const ids:string[]=[];
 const reached=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
 const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async target=>{ids.push(target.jobId);return{dispose(){},async run(){active++;started++;peak=Math.max(peak,active);if(started===concurrency)ready();await gate;active--;return{verifiedCount:1,pendingCount:0,message:'核对',canReview:true};}};}});
 queue.setConcurrency(concurrency);await queue.start(targets,1);await reached;
 assert.equal(queue.getState().activeItemIds?.length,concurrency);assert.equal(queue.getState().status,'running');
 for(const id of queue.getState().activeItemIds??[])assert.throws(()=>queue.closePage(id),/停止/);
 release();await queue.settled();assert.equal(peak,concurrency);assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
 assert.equal(queue.getState().status,'finished');assert.equal(queue.getState().completedCount,5);assert.equal(queue.getState().activeItemIds?.length,0);queue.dispose();
});
test('cancelling concurrent workers aborts all active sessions and never starts queued tasks',async()=>{
 let started=0,ready!:()=>void;const reached=new Promise<void>(r=>{ready=r;});
 const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async()=>({dispose(){},async run(_p,signal){
  started++;if(started===3)ready();await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));throw Error('stopped');}})});
 queue.setConcurrency(3);await queue.start(targets,1);await reached;queue.cancel();await queue.settled();
 assert.equal(started,3);assert.equal(queue.getState().status,'cancelled');assert.equal(queue.getState().activeItemIds?.length,0);
 assert.ok(queue.getState().items.every(i=>i.status==='cancelled'));queue.dispose();
});
test('unsupported concurrency is rejected before opening any page',()=>{
 const queue=new ApplicationFillQueue({getProfile:async()=>profile(),createPage:async()=>{throw Error('must not open');}});
 assert.throws(()=>queue.setConcurrency(2 as any));queue.dispose();
});
