import test from 'node:test';import assert from 'node:assert/strict';
import {UniversalFormSession} from '../packages/browser/src/universal-form.js';
test('resolving a late field uses one host query without enumerating earlier controls',async()=>{
 const session:any=Object.create(UniversalFormSession.prototype);const calls:string[]=[];const node={count:async()=>{calls.push('count');return 1;}};
 session.timings={pageReads:0,pageReadMs:0,controlLookups:0,controlLookupMs:0};session.page={locator:(selector:string)=>{calls.push(selector);return{nth:(index:number)=>{assert.equal(index,199);return node;},all:()=>{throw Error('per-node RPC regression');}};}};
 assert.equal(await session.control({index:199}),node);assert.equal(calls.length,2);assert.equal(session.getPerformance().controlLookups,1);assert.ok(session.getPerformance().controlLookupMs>=0);
 node.count=async()=>0;await assert.rejects(session.control({index:199}),/FIELD_DISAPPEARED/);
});
test('major taxonomy selection stays a category review draft even when model claims equivalence',()=>{
 const session:any=Object.create(UniversalFormSession.prototype);Object.assign(session,{facts:[{ref:'fact-0',kind:'major',value:'统计学原文'}],restoredDraftKeys:new Set(),draftAttempts:[],unverified:new Map(),question:()=>undefined,activity:()=>{}});
 const field={group:'edu',identity:'major-type',index:2,label:'专业类型',section:'教育经历',value:'理工类'};
 const result=session.recordDraft(field,field,{kind:'selection',relation:'equivalent',facts:['fact-0'],reason:'相关学科归类'});
 assert.equal(result.draft.relation,'category');assert.equal(result.draft.needsReview,true);assert.equal(result.verified,false);assert.equal(session.facts[0].value,'统计学原文');
});
