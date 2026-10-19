import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import{tmpdir}from'node:os';
import{fauxAssistantMessage,fauxToolCall}from'@earendil-works/pi-ai';
import {createDemoModel} from '../packages/runtime/src/demo-model.js';
import{runBackgroundFormAgent}from'../packages/agent/src/background-form-agent.js';
import type{BackgroundModelProvider}from'../packages/agent/src/background-model-provider.js';
import{backgroundSnapshot}from'../packages/browser/src/background-scripts.js';
import type{Profile}from'../packages/shared/src/contracts.js';
const profile=():Profile=>({version:1,updatedAt:'2026-10-19',fullName:'虚构甲',fullNameEn:'Fictional QA',email:'qa@example.invalid',phone:'+1 202-555-0100',school:'虚构大学',schoolEn:'',degree:'硕士',major:'AI',majorEn:'',graduationMonth:'2027-06',skills:[],targetRoles:[],cities:[],resumeText:''});
test('scripted SDK contract: only model-requested valid fields execute; unrelated salary/company/links are rejected',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'background-agent-contract-'));const demo=await createDemoModel();let writes=0;const p=profile();
 const raw={url:'https://example.invalid/apply',fields:['Full name','Email','Phone','Current company','LinkedIn URL','Expected salary'].map((label,index)=>({index,label,type:['text','email','tel','text','text','text'][index]!,value:'',identity:'id'+index,options:[],editable:true,required:false,section:label,bounds:{x:0,y:0,width:100,height:20}})),protected:[]};
 const provider={runtime:demo.modelRuntime,model:demo.model,attempts:[],withTask:(_id:string,fn:()=>Promise<any>)=>fn()} as unknown as BackgroundModelProvider;
 demo.faux.setResponses([
  fauxAssistantMessage(fauxToolCall('read_confirmed_profile',{}),{stopReason:'toolUse'}),
  fauxAssistantMessage(fauxToolCall('inspect_form',{}),{stopReason:'toolUse'}),
  context=>{const r=context.messages.findLast(m=>m.role==='toolResult');const observed=JSON.parse(r!.content.filter(b=>b.type==='text').map((b:any)=>b.text).join(''));
   return fauxAssistantMessage(fauxToolCall('fill_confirmed_fields',{observationId:observed.observationId,mappings:['fullName','email','phone','school','major','degree'].map((profileKey,index)=>({fieldId:'field-'+index,profileKey}))}),{stopReason:'toolUse'});},
  fauxAssistantMessage(fauxToolCall('read_fill_status',{}),{stopReason:'toolUse'}),fauxAssistantMessage('已核对，缺资料未填，未提交。')]);
 let evidence:any;
 try{const result=await runBackgroundFormAgent({provider,directory,taskId:'unit-only',profile:p,variant:'improved',signal:new AbortController().signal,progress(){},onEvidence:e=>{evidence=e;},transport:{
   read:async()=>structuredClone(raw),getURL:()=>raw.url,getGeneration:()=>1,getProfile:async()=>p,settle:async()=>{},write:async input=>{assert.equal(input.expectedSnapshot,backgroundSnapshot(raw));writes++;raw.fields[input.index]!.value=input.value;return{status:'written'};}}});
  assert.equal(result.verifiedCount,3);assert.equal(writes,3);assert.equal(evidence.rejectedMappings,3);assert.equal(evidence.statusReads,1);
  assert.ok(raw.fields.slice(3).every(f=>f.value===''));assert.equal(evidence.modelCalls,0,'scripted contract test is never a paid-model result');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('scripted final text without an execution tool is not successful Agent work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'background-agent-no-action-')),demo=await createDemoModel(),p=profile();
 demo.faux.setResponses([fauxAssistantMessage('已经全部填写成功。')]);let evidence:any,writes=0;
 try{const result=await runBackgroundFormAgent({provider:{runtime:demo.modelRuntime,model:demo.model,attempts:[],withTask:(_id:string,fn:()=>Promise<any>)=>fn()} as unknown as BackgroundModelProvider,
  directory,taskId:'unit-no-action',profile:p,signal:new AbortController().signal,variant:'improved',progress(){},onEvidence:e=>{evidence=e;},transport:{getURL:()=> 'https://example.invalid/apply',getGeneration:()=>1,getProfile:async()=>p,
  read:async()=>({url:'https://example.invalid/apply',fields:[],protected:[]}),write:async()=>{writes++;return{status:'written'};}}});
  assert.equal(writes,0);assert.equal(evidence.failure,'agent-omitted-execution');assert.equal(result.pendingCount,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('omitted final read triggers one real SDK continuation and cannot write during that continuation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'background-agent-final-read-')),demo=await createDemoModel(),p=profile();let evidence:any;
 const raw={url:'https://example.invalid/apply',fields:[{index:0,label:'Email',type:'email',value:'',identity:'email|email',options:[],editable:true,required:false,section:'',bounds:{x:0,y:0,width:100,height:20}}],protected:[]};
 demo.faux.setResponses([
  fauxAssistantMessage(fauxToolCall('read_confirmed_profile',{}),{stopReason:'toolUse'}),
  fauxAssistantMessage(fauxToolCall('inspect_form',{}),{stopReason:'toolUse'}),
  context=>{const r=context.messages.findLast(m=>m.role==='toolResult');const observed=JSON.parse(r!.content.filter(b=>b.type==='text').map((b:any)=>b.text).join(''));
   return fauxAssistantMessage(fauxToolCall('fill_confirmed_fields',{observationId:observed.observationId,mappings:[{fieldId:'field-0',profileKey:'email'}]}),{stopReason:'toolUse'});},
  fauxAssistantMessage('填好了。'),
  fauxAssistantMessage(fauxToolCall('read_fill_status',{}),{stopReason:'toolUse'}),fauxAssistantMessage('实际读回正确，未提交。')]);
 try{await runBackgroundFormAgent({provider:{runtime:demo.modelRuntime,model:demo.model,attempts:[],withTask:(_id:string,fn:()=>Promise<any>)=>fn()} as unknown as BackgroundModelProvider,
  directory,taskId:'unit-continuation',profile:p,signal:new AbortController().signal,variant:'improved',progress(){},onEvidence:e=>evidence=e,
  transport:{getURL:()=>raw.url,getGeneration:()=>1,getProfile:async()=>p,read:async()=>structuredClone(raw),settle:async()=>{},write:async input=>{raw.fields[0]!.value=input.value;return {status:'written'};}}});
  assert.equal(evidence.statusReads,1);assert.equal(evidence.finalReadContinuations,1);assert.equal(evidence.failure,null);
  assert.equal(evidence.events.filter((e:any)=>e.type==='tool_started'&&e.data.toolName==='read_fill_status').length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('conflicts are all rejected per field without choosing a key; valid model mappings execute and missing facts surface',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'background-agent-conflict-')),demo=await createDemoModel(),p=profile();p.phone='';let evidence:any,writes=0;
 const raw={url:'https://example.invalid/apply',fields:['Full name','Email','Phone','School / Major','Legal Name (if different than above)'].map((label,index)=>({index,label,type:index===1?'email':'text',value:'',identity:'id'+index,options:[],editable:true,required:true,section:label,bounds:{x:0,y:0,width:100,height:20}})),protected:[]};
 demo.faux.setResponses([
  fauxAssistantMessage(fauxToolCall('read_confirmed_profile',{}),{stopReason:'toolUse'}),fauxAssistantMessage(fauxToolCall('inspect_form',{}),{stopReason:'toolUse'}),
  context=>{const r=context.messages.findLast(m=>m.role==='toolResult');const observed=JSON.parse(r!.content.filter(b=>b.type==='text').map((b:any)=>b.text).join(''));
   return fauxAssistantMessage(fauxToolCall('fill_confirmed_fields',{observationId:observed.observationId,mappings:[{fieldId:'field-0',profileKey:'fullName'},{fieldId:'field-1',profileKey:'email'},
    {fieldId:'field-2',profileKey:'phone'},{fieldId:'field-3',profileKey:'school'},{fieldId:'field-3',profileKey:'major'},{fieldId:'field-4',profileKey:'fullName'},{fieldId:'field-999',profileKey:'school'}]}),{stopReason:'toolUse'});},
  fauxAssistantMessage(fauxToolCall('read_fill_status',{}),{stopReason:'toolUse'}),fauxAssistantMessage('请补充确认资料。未提交。')]);
 try{const result=await runBackgroundFormAgent({provider:{runtime:demo.modelRuntime,model:demo.model,attempts:[],withTask:(_id:string,fn:()=>Promise<any>)=>fn()} as unknown as BackgroundModelProvider,
  directory,taskId:'unit-conflicts',profile:p,signal:new AbortController().signal,variant:'improved',progress(){},onEvidence:e=>evidence=e,
  transport:{getURL:()=>raw.url,getGeneration:()=>1,getProfile:async()=>p,read:async()=>structuredClone(raw),settle:async()=>{},write:async input=>{writes++;raw.fields[input.index]!.value=input.value;return {status:'written'};}}});
  assert.equal(writes,2);assert.equal(evidence.fillCalls,1);assert.equal(evidence.statusReads,1);assert.equal(evidence.failure,null);
  assert.deepEqual(raw.fields.slice(2).map(f=>f.value),['','','']);assert.equal(evidence.rejectedMappings,4);
  assert.ok(evidence.reviewFields.some((f:any)=>f.label==='Phone'&&/缺少/.test(f.reason)));assert.match(result.message,/补充或确认/);
  assert.ok(!evidence.events.some((e:any)=>e.type==='tool_finished'&&e.data.isError));
 }finally{await rm(directory,{recursive:true,force:true});}
});
