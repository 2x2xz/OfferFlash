import test from 'node:test';
import assert from 'node:assert/strict';
import {UniversalFormSession} from '../packages/browser/src/universal-form.js';
import {applicationFacts,factFitsField} from '../packages/forms/src/application-facts.js';
import {matchExistingRecord} from '../packages/forms/src/record-binding.js';
import {overrideProfile} from './fixtures/override-profile.js';
import {FormAttemptMemory} from '../packages/browser/src/form-attempt-memory.js';
import {recordCoverage} from '../packages/forms/src/record-coverage.js';
import {READ_UNIVERSAL_FORM} from '../packages/browser/src/universal-read.js';
const facts=applicationFacts(overrideProfile);
const target={index:0,label:'项目职责',type:'textarea',section:'项目经历',group:'contact',identity:'role',value:'',editable:true,options:[]};
const sessionFor=(field=target)=>{
 const session:any=Object.create(UniversalFormSession.prototype);
 Object.assign(session,{facts,view:{fields:[field],actions:[]},bindings:new Map(),recordCache:new Map(),semanticMappings:new Map(),pendingAddKinds:new Set(),addCounts:new Map()});
 return session;
};
test('career fact resolution, semantic mapping and drafts reject an ungrouped career field',()=>{
 const session=sessionFor(),role=facts.find(f=>f.record==='project-1'&&f.kind==='role')!;
 assert.throws(()=>session.resolve(role.ref,target),/RECORD_BINDING_CONFLICT/);
 assert.equal(session.sourceScopeIssue(target,[role]),'RECORD_BINDING_CONFLICT');
 session.ordinaryTarget=()=>true;
 assert.equal(session.draftTargetAllowed(target),false);
});
test('unrecognised existing records cannot authorize additional rows',()=>{
 const session=sessionFor();
 assert.equal(session.additionAllowed({label:'添加项目经历',recordKind:'project'}),false);
});
test('explicit past end date can clear present checkbox; absent dates cannot',()=>{
 const end=facts.find(f=>f.record==='project-1'&&f.kind==='endDate')!,field={...target,label:'至今',type:'checkbox',checked:true};
 const dated={...end,value:'2026-08'};
 assert.equal(factFitsField(dated,field),true);
 assert.equal(factFitsField({...dated,value:''},field),false);
 const session=sessionFor(field as any);
 assert.equal(session.matches(field,dated),false);
 assert.equal(session.matches({...field,checked:false},dated),true);
 assert.equal(session.matches(field,{...dated,value:'至今'}),true);
});
test('unique dates alone cannot identify projects or internships',()=>{
 const own=[{ref:'f-1',record:'project-1',kind:'startDate',label:'开始年月',value:'2024-01'},
  {ref:'f-2',record:'project-1',kind:'endDate',label:'结束年月',value:'2024-02'}];
 const fields=own.map(f=>({label:f.kind==='startDate'?'开始时间':'结束时间',type:'text',section:'项目经历',value:f.value}));
 assert.equal(matchExistingRecord(fields,own),undefined);
});
test('reader remains a syntactically valid fixed program after anonymous topology changes',()=>{
 assert.doesNotThrow(()=>new Function('return '+READ_UNIVERSAL_FORM));
});

test('an unexplained populated row is reconciled before assigning a spare empty row',()=>{
 const fields=[{...target,group:'populated',label:'项目描述',value:'尚未核对身份的已有项目'}, {...target,group:'empty',label:'项目描述',value:''}];
 const coverage=recordCoverage(facts,fields,new Set(['project']),new Map());
 assert.equal(coverage.find(item=>item.record==='project-1')?.state,'ambiguous');
 assert.deepEqual(coverage.find(item=>item.record==='project-1')?.groups,['populated']);
});

test('unknown additions survive explicit retry and a new model or profile memory for the same document',()=>{
 const documentLocks=new Set<string>(),first=new FormAttemptMemory(documentLocks);
 first.unknownAddKinds.add('project');first.resetFailures();
 const next=new FormAttemptMemory(documentLocks);
 assert.equal(next.unknownAddKinds.has('project'),true);
 const navigated=new FormAttemptMemory(new Set());
 assert.equal(navigated.unknownAddKinds.size,0);
});

test('highest confirmed qualification survives a missing or lower default education',()=>{
 const copy=structuredClone(overrideProfile);copy.career!.primaryEducationId='';
 const withoutDefault=applicationFacts(copy),degree=withoutDefault.find(fact=>fact.record==='summary'&&fact.kind==='degree');
 assert.equal(degree?.value,'硕士');
 assert.ok(withoutDefault.some(fact=>fact.record==='summary'&&fact.kind==='endDate'&&fact.sourceRecordId));
 copy.career!.primaryEducationId=copy.career!.educations[1]!.id;
 assert.equal(applicationFacts(copy).find(fact=>fact.record==='summary'&&fact.kind==='degree')?.value,'硕士');
});

test('spare project row cannot request a model draft using personal skills or already-bound projects',()=>{
 const extra={...target,group:'spare',label:'项目描述'},session=sessionFor(extra);
 session.needsWrite=()=>true;session.ordinaryTarget=()=>true;
 for(const record of new Set(facts.filter(f=>f.record.startsWith('project-')).map(f=>f.record)))session.bindings.set('bound-'+record,record);
 assert.equal(session.sourceScopeIssue(extra,[{ref:'skills',record:'personal',kind:'skills',label:'技能',value:'已确认技能'}]),'RECORD_BINDING_CONFLICT');
 assert.equal(session.canDraftField(extra),false);
});

test('missing day, absent referral and final declaration explain user action without requesting profile facts',()=>{
 const session=sessionFor();session.priorFailure=()=>undefined;session.redundantEmptyRecord=()=>false;
 assert.match(session.manualReason({...target,label:'推荐码',section:''}),/留空/);
 assert.match(session.manualReason({...target,label:'上述已知悉并确认',section:'',type:'checkbox'}),/自行阅读/);
 session.facts=[{ref:'date',record:'summary',kind:'endDate',label:'毕业年月',value:'2027-07'}];
 assert.match(session.manualReason({...target,label:'毕业时间',section:'',datePrecision:'day',type:'combobox'}),/只有月份/);
});
