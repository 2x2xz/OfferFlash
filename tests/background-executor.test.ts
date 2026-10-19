import assert from 'node:assert/strict';
import test from 'node:test';
import { runBackgroundOrdinaryFill, type BackgroundFormTransport } from '../packages/browser/src/background-executor.js';
import { backgroundSnapshot, backgroundWriteScript, type BackgroundWriteRequest } from '../packages/browser/src/background-scripts.js';
import type { Profile } from '../packages/shared/src/contracts.js';
import {emptyCareerInput,newCareerRecord} from '../packages/profile/src/career-input.js';
import {BackgroundFillError} from '../packages/domain/src/application-queue.js';

const profile = (): Profile => ({version:3,updatedAt:'2026-10-19T00:00:00Z',fullName:'虚构候选人',fullNameEn:'',email:'candidate@example.invalid',phone:'13800000000',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:''});
function fixture() {
  const p=profile();let writes=0;let generation=2;
  const raw={url:'https://example.invalid/apply',title:'虚构申请',loginRequired:false,protected:[{type:'checkbox',checked:false}],
    fields:['姓名','邮箱','手机号'].map((label,index)=>({index,label,type:['text','email','tel'][index],value:'',required:true,editable:true,
      section:'个人资料',identity:`id-${index}`,options:[],bounds:{x:10,y:20+index*60,width:200,height:30}}))};
  const transport:BackgroundFormTransport={read:async()=>structuredClone(raw),getProfile:async()=>structuredClone(p),getURL:()=>raw.url,
    getGeneration:()=>generation,settle:async()=>{},write:async input=>{
      writes++;assert.equal(input.expectedSnapshot,backgroundSnapshot(raw));raw.fields[input.index]!.value=input.value;return {status:'written'};
    }};
  return {p,raw,transport,writes:()=>writes,bump:()=>generation++};
}
test('background executor fills and independently verifies only approved ordinary blanks, without native focus APIs',async()=>{
  const f=fixture(),progress:number[]=[];const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,count=>progress.push(count));
  assert.equal(result.verifiedCount,3);assert.equal(f.writes(),3);assert.deepEqual(progress,[1,2,3]);assert.equal(f.raw.protected[0]?.checked,false);
  assert.deepEqual(f.raw.fields.map(field=>field.value),['虚构候选人','candidate@example.invalid','13800000000']);
});
test('existing values, declarations, login credentials, date/custom controls are never overwritten',async()=>{
  const f=fixture();f.raw.fields[0]!.value='网页已填姓名';f.raw.fields[1]!.label='隐私协议';f.raw.fields[1]!.type='checkbox';f.raw.fields[2]!.type='month';
  const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(f.writes(),0);assert.equal(result.verifiedCount,0);assert.ok(result.pendingCount>0);assert.equal(f.raw.fields[0]!.value,'网页已填姓名');
  f.raw.loginRequired=true;assert.match((await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{})).message,/登录/);
});
test('one retry requires entire pre-write snapshot unchanged; successful second attempt verified once',async()=>{
  const f=fixture();let attempts=0;const original=f.transport.write;
  f.transport.write=async input=>{attempts++;return attempts===1?{status:'written'}:original(input);};
  const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(attempts,4);assert.equal(result.verifiedCount,3);
});
test('different value or protected control change stops immediately and never retries',async()=>{
  for(const mode of ['changed-value','agreement'] as const){
    const f=fixture();let attempts=0;
    f.transport.write=async input=>{attempts++;f.raw.fields[input.index]!.value=mode==='changed-value'?'网页自行修改':input.value;if(mode==='agreement')f.raw.protected[0]!.checked=true;return {status:'written'};};
    await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{}), (error: unknown) => error instanceof BackgroundFillError && error.reason === 'value-not-retained');assert.equal(attempts,1);
  }
});
test('late reversion, profile changes, navigation and cancellation stop further writes',async()=>{
  for(const mode of ['revert','profile','navigation','cancel'] as const){
    const f=fixture(),abort=new AbortController();let waits=0;
    f.transport.settle=async(ms)=>{if(ms===150)return;waits++;if(waits===1){if(mode==='profile')f.p.version++;if(mode==='navigation')f.bump();if(mode==='cancel')abort.abort();}
      if(mode==='revert'&&waits===2)f.raw.fields[0]!.value='';};
    await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,abort.signal,()=>{}));assert.equal(f.writes(),1);
  }
});
test('read-only preparation waits for asynchronous fields before planning, without writing to an older snapshot',async()=>{
  const f=fixture();let samples=0;
  f.transport.settle=async ms=>{if(ms!==150)return;assert.equal(f.writes(),0);samples++;if(samples===1)f.raw.fields[1]!.identity='hydrated-email';};
  const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(samples,3);assert.equal(result.verifiedCount,3);
});
test('continuously changing pages exhaust bounded preparation with zero writes',async()=>{
  const f=fixture();let samples=0;
  f.transport.settle=async ms=>{assert.equal(ms,150);f.raw.fields[1]!.identity=`changing-${++samples}`;};
  await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{}), (error:unknown)=>error instanceof BackgroundFillError&&error.reason==='page-changing');
  assert.equal(samples,8);assert.equal(f.writes(),0);
});
test('profile, navigation and cancellation changes during preparation prevent all input',async()=>{
  for(const mode of ['profile','navigation','cancel'] as const){
    const f=fixture(),abort=new AbortController();
    f.transport.settle=async()=>{if(mode==='profile')f.p.version++;if(mode==='navigation')f.bump();if(mode==='cancel')abort.abort();};
    await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,abort.signal,()=>{}));assert.equal(f.writes(),0);
  }
});
test('missing confirmed facts prompt profile completion and remain blank rather than guessed',async()=>{
  const f=fixture();f.p.phone='';
  const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(result.attention,'info');assert.match(result.message,/个人资料补充并确认电话/);assert.equal(f.raw.fields[2]!.value,'');assert.equal(f.writes(),2);
});
test('guard diagnostics identify startup generation changes but cannot alter a safe stop',async()=>{
  const f=fixture();let reason='',planned: boolean|undefined;
  f.transport.onGuardStop=(r,p)=>{reason=r;planned=p;throw new Error('private diagnostics failed');};
  f.transport.settle=async()=>{f.bump();};
  await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{}),/页面或资料版本已变化/);
  assert.equal(reason,'generation');assert.equal(planned,false);assert.equal(f.writes(),0);
});
test('model mode never fills a rule-ready field omitted by the model',async()=>{
 const f=fixture();const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{},
   {modelMappings:new Map([['field-1','email']]),expectedSnapshot:backgroundSnapshot(f.raw),expectedGeneration:2});
 assert.equal(result.verifiedCount,1);assert.equal(f.writes(),1);assert.equal(f.raw.fields[0]!.value,'');assert.equal(f.raw.fields[2]!.value,'');
});
test('model plan remains bound to the exact observation and generation before any input',async()=>{
 for(const mode of ['snapshot','generation']){const f=fixture();
  await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{},
   {modelMappings:new Map([['field-1','email']]),expectedSnapshot:mode==='snapshot'?'changed':backgroundSnapshot(f.raw),expectedGeneration:mode==='generation'?1:2}));
  assert.equal(f.writes(),0);
 }
});
test('write script accepts only host index/value/snapshot and contains no native focus, click or submit invocation',()=>{
  const source=backgroundWriteScript({url:'https://example.invalid/apply',index:0,value:'虚构',expectedSnapshot:'{}'});
  assert.match(source,/expectedSnapshot/);assert.match(source,/HTMLInputElement\.prototype/);
  assert.ok(!/\.focus\(|\.click\(|\.submit\(|requestSubmit\(|sendInputEvent|insertText/.test(source));
  for(const index of [-1,300,0.1])assert.throws(()=>backgroundWriteScript({url:'https://example.invalid/apply',index,value:'x',expectedSnapshot:'{}'}));
});
test('background month support reuses confirmed default education without guessing a full day',async()=>{
  const f=fixture();f.p.career={...emptyCareerInput(),sources:[],educations:[{...newCareerRecord('educations','master'),school:'虚构大学',degree:'硕士',major:'计算机',startDate:'2025-09',endDate:'2027-06',
    revision:1,confirmation:'confirmed',confirmedRevision:1,confirmedAt:'2026-10-19T00:00:00Z'}],internships:[],projects:[],publications:[],primaryEducationId:'master'};
  f.raw.fields[0]!.label='毕业时间';f.raw.fields[0]!.type='month';f.raw.fields[1]!.label='预计毕业时间';f.raw.fields[1]!.type='date';f.raw.fields[2]!.value='已有手机';
  const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(result.verifiedCount,1);assert.equal(f.raw.fields[0]!.value,'2027-06');assert.equal(f.raw.fields[1]!.value,'');assert.equal(f.writes(),1);
});
test('stable control reindex preserves exact values/protected state and safely rebinds remaining targets',async()=>{
 const f=fixture();const base=f.transport.write;let once=false;
 f.transport.write=async input=>{const result=await base(input);if(!once){once=true;for(const field of f.raw.fields)field.index+=4;}return result;};
 // Real transport addresses DOM indexes rather than array offsets.
 f.transport.write=async input=>{assert.equal(input.expectedSnapshot,backgroundSnapshot(f.raw));const field=f.raw.fields.find(f=>f.index===input.index)!;field.value=input.value;
  if(!once){once=true;for(const field of f.raw.fields)field.index+=4;}return {status:'written'};};
 const result=await runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{});
 assert.equal(result.verifiedCount,3);assert.deepEqual(f.raw.fields.map(f=>f.value),['虚构候选人','candidate@example.invalid','13800000000']);
});
test('reindex never excuses a non-target value, option, identity, protected state or ambiguous binding change',async()=>{
 for(const mode of ['other-value','option','identity','protected','ambiguous','new-field'] as const){
  const f=fixture();let writes=0;
  f.transport.write=async input=>{writes++;f.raw.fields[0]!.value=input.value;for(const field of f.raw.fields)field.index+=3;
   if(mode==='other-value')f.raw.fields[1]!.value='changed';if(mode==='option')(f.raw.fields[1]!.options as any[]).push({label:'new',value:'new'});
   if(mode==='identity')f.raw.fields[1]!.identity='other';if(mode==='protected')f.raw.protected[0]!.checked=true;
   if(mode==='ambiguous'){f.raw.fields[1]!.identity=f.raw.fields[0]!.identity;}if(mode==='new-field')f.raw.fields.push({...f.raw.fields[1]!,index:99});
   return {status:'written'};};
  await assert.rejects(runBackgroundOrdinaryFill(f.transport,f.p,new AbortController().signal,()=>{}));assert.equal(writes,1);
 }
});
