import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundCareerSnapshot, backgroundCareerWriteScript, runBackgroundCareerFill, type BackgroundCareerTransport } from '../packages/browser/src/background-career.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import type { Profile } from '../packages/shared/src/contracts.js';

function fixture(){
  const p:Profile={version:5,updatedAt:'2026-10-19T00:00:00Z',fullName:'',fullNameEn:'',email:'',phone:'',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:'',career:{...emptyCareerInput(),sources:[],educations:[],projects:[],publications:[],internships:[{
    ...newCareerRecord('internships','intern-one'),organization:'虚构星河公司',role:'算法实习生',description:'虚构检索实现。',startDate:'2026-06',endDate:'',current:true,
    confirmation:'confirmed',revision:2,confirmedRevision:2,confirmedAt:'2026-10-19T00:00:00Z'}]}};
  const raw:any={url:'https://modelbest.jobs.feishu.cn/fixture',supported:true,reason:'',groups:[{id:'internship[0]',kind:'internship',key:'0',identity:'fictional-group',fields:[
    {fieldId:'internship[0].company',path:'internship[0].company',property:'company',kind:'internship',type:'text',value:'虚构星河公司',editable:true,identity:'company-field'},
    {fieldId:'internship[0].title',path:'internship[0].title',property:'title',kind:'internship',type:'text',value:'',editable:true,identity:'role-field'},
    {fieldId:'internship[0].period:end',path:'internship[0].period',property:'period',kind:'internship',side:'end',type:'feishu-month',value:'',editable:true,identity:'end-field',supportsUntilNow:true},
  ]}],addControls:[],protectedControls:[{identity:'agreement',value:'',checked:false,disabled:false,readOnly:false,sensitive:false}]};
  const writes:string[]=[];
  const transport:BackgroundCareerTransport={read:async()=>structuredClone(raw),getProfile:async()=>structuredClone(p),getURL:()=>raw.url,getGeneration:()=>3,settle:async()=>{},
    write:async input=>{assert.equal(input.expectedSnapshot,backgroundCareerSnapshot(raw));writes.push(input.fieldId);raw.groups.flatMap((group:any)=>group.fields).find((field:any)=>field.fieldId===input.fieldId).value=input.value;return {status:'written'};}};
  return {p,raw,transport,writes};
}
test('background reviewed career fills only blank uniquely matched confirmed text and leaves until-now control alone',async()=>{
  const f=fixture(),result=await runBackgroundCareerFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(result.verifiedCount,1);assert.equal(result.pendingCount,1);assert.deepEqual(f.writes,['internship[0].title']);
  assert.equal(f.raw.groups[0].fields[0].value,'虚构星河公司');assert.equal(f.raw.groups[0].fields[2].value,'');
});
test('unknown existing group or unconfirmed record never gets a guessed background binding',async()=>{
  for(const mode of ['unknown','unconfirmed'] as const){
    const f=fixture();if(mode==='unknown')f.raw.groups[0].fields[0].value='别的公司';else f.p.career!.internships[0]!.confirmation='pending';
    const result=await runBackgroundCareerFill(f.transport,f.p,new AbortController().signal,()=>{});
    assert.equal(result.verifiedCount,0);assert.ok(result.pendingCount>0);assert.equal(f.writes.length,0);
  }
});
test('multiple confirmed records do not map into a completely blank career group by order',async()=>{
  const f=fixture();f.raw.groups[0].fields[0].value='';f.p.career!.internships.push({...structuredClone(f.p.career!.internships[0]!),id:'intern-two',organization:'另一家虚构公司'});
  const result=await runBackgroundCareerFill(f.transport,f.p,new AbortController().signal,()=>{});
  assert.equal(result.verifiedCount,0);assert.match(result.message,/多条候选/);assert.equal(f.writes.length,0);
});
test('career protected control changes and stale profile stop after attempted field without duplicate retry',async()=>{
  for(const mode of ['protected','profile'] as const){
    const f=fixture(),original=f.transport.write;
    f.transport.write=async input=>{const result=await original(input);if(mode==='protected')f.raw.protectedControls[0].checked=true;else f.p.version++;return result;};
    await assert.rejects(runBackgroundCareerFill(f.transport,f.p,new AbortController().signal,()=>{}));assert.equal(f.writes.length,1);
  }
});
test('background career write scope rejects school autocomplete, degree, date, add controls and injected selectors',()=>{
  for(const fieldId of ['education[0].school','education[0].degree','internship[0].period:end','internship:add','input[name="title"]']){
    assert.throws(()=>backgroundCareerWriteScript({url:'https://modelbest.jobs.feishu.cn/fixture',fieldId,value:'虚构',expectedSnapshot:'{}'}));
  }
  const source=backgroundCareerWriteScript({url:'https://modelbest.jobs.feishu.cn/fixture',fieldId:'internship[0].title',value:'虚构',expectedSnapshot:'{}'});
  assert.ok(!/\.focus\(|\.click\(|\.submit\(|requestSubmit\(|sendInputEvent|insertText/.test(source));
});
