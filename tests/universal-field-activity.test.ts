import test from 'node:test';
import assert from 'node:assert/strict';
import {UniversalFormSession} from '../packages/browser/src/universal-form.js';
import type {FieldCompanionTarget} from '../packages/browser/src/field-companion.js';
import {profile} from './fixtures/moka-form.js';

// Recorded host observations and in-memory write receipts. No synthetic web
// form, website, browser, normal profile, or model is run by these unit checks.
function fixture(report:(target:FieldCompanionTarget)=>unknown,dropWrite=false){
 const url='https://fixture.invalid/application';let generation=1,writes=0;
 const field={index:0,identity:'name-input',label:'姓名',section:'',group:'contact',type:'text',value:'',options:[],editable:true,bounds:{x:100,y:120,width:240,height:36}};
 const view={url,fields:[field],actions:[],options:[],sections:[]};
 const element={parentElement:{closest:()=>null},closest:()=>null,blur(){}};
 const node={count:async()=>1,evaluate:async(fn:(element:any)=>unknown)=>fn(element),fill:async(value:string)=>{writes++;if(!dropWrite)field.value=value;}};
 const page={url:()=>url,isClosed:()=>false,evaluateHandle:async()=>({evaluate:async()=>structuredClone(view),dispose:async()=>{}}),locator:()=>({all:async()=>[node],nth:(index:number)=>{assert.equal(index,0);return node;}})};
 const abort=new AbortController();const session=new UniversalFormSession(page as never,profile,async()=>profile,()=>generation,abort.signal,true,{answers:[]},report);
 return {session,abort,field,get writes(){return writes;},changeGeneration(){generation++;}};
}
async function fill(value:ReturnType<typeof fixture>){const observation=await value.session.inspect();const target=observation.page.fields.find(field=>field.label==='姓名')!;const fact=target.candidates[0]??value.session.facts.find(fact=>fact.value===profile.fullName)?.ref;assert.ok(fact);return value.session.act({observation:observation.observation,action:'fill',target:target.ref,fact});}
test('universal writes publish observed coordinates only and report verified after retained value checks',async()=>{
 const events:FieldCompanionTarget[]=[];const value=fixture(target=>events.push(structuredClone(target)));
 const result=await fill(value);assert.equal(result.verified,true);assert.equal(value.writes,1);assert.deepEqual(events.map(e=>e.phase),['approach','verified']);
 for(const event of events){assert.deepEqual(Object.keys(event).sort(),['bounds','phase']);assert.deepEqual(event.bounds,{x:100,y:120,width:240,height:36});assert.ok(!JSON.stringify(event).includes(profile.fullName));}
 value.session.close();
});
test('a thrown, rejected or never-completing animation observer cannot fail or delay the write result',{timeout:3000},async()=>{
 for(const report of [()=>{throw Error('visual failure');},()=>Promise.reject(Error('visual failure')),()=>new Promise(()=>{})]){const value=fixture(report);assert.equal((await fill(value)).verified,true);assert.equal(value.writes,1);value.session.close();}
});
test('failed retention has no success animation; unchanged existing fields have no fabricated new activity',async()=>{
 const events:FieldCompanionTarget[]=[];const bad=fixture(target=>events.push(target),true);await assert.rejects(fill(bad),/VALUE_NOT_RETAINED/);assert.deepEqual(events.map(e=>e.phase),['approach']);bad.session.close();
 events.length=0;const existing=fixture(target=>events.push(target));existing.field.value=profile.fullName;const result=await fill(existing);assert.ok('alreadyCorrect' in result&&result.alreadyCorrect===true);assert.equal(existing.writes,0);assert.deepEqual(events,[]);existing.session.close();
});
test('cancellation and closing prevent both writes and visual activity',async()=>{
 for(const kind of ['abort','closed']){const events:FieldCompanionTarget[]=[];const value=fixture(target=>events.push(target));const observation=await value.session.inspect();if(kind==='abort')value.abort.abort();else value.session.close();await assert.rejects(value.session.act({observation:observation.observation,action:'fill',target:observation.fields[0]!.ref,fact:observation.fields[0]!.candidates[0]}),/APPLICATION_CONTEXT_CHANGED/);assert.equal(value.writes,0);assert.deepEqual(events,[]);value.session.close();}
});
test('a changed document after writing prevents subsequent activity without changing the existing one-recovery preparation rule',async()=>{
 const events:FieldCompanionTarget[]=[];const value=fixture(target=>events.push(target));await fill(value);events.length=0;value.changeGeneration();await assert.rejects(value.session.inspect(),/APPLICATION_CONTEXT_CHANGED/);assert.equal(value.writes,1);assert.deepEqual(events,[]);value.session.close();
});
