import test from 'node:test';
import assert from 'node:assert/strict';
import {recordCoverage,sectionMatchesRecord} from '../packages/forms/src/record-coverage.js';
import {matchExistingRecord,inferRecordSection} from '../packages/forms/src/record-binding.js';
import {factFitsField,type ApplicationFact} from '../packages/forms/src/application-facts.js';
import {UniversalFormSession} from '../packages/browser/src/universal-form.js';

const facts:ApplicationFact[]=[
 {ref:'a',record:'education-1',kind:'school',label:'学校',value:'A大学',sourceRecordId:'source-a',sourceRevision:3},
 {ref:'b',record:'education-1',kind:'major',label:'专业',value:'物理'},
 {ref:'c',record:'education-2',kind:'school',label:'学校',value:'B大学',sourceRecordId:'source-b',sourceRevision:2},
 {ref:'d',record:'education-2',kind:'major',label:'专业',value:'数学'},
 {ref:'e',record:'internship-1',kind:'organization',label:'实习单位',value:'C公司'},
 {ref:'f',record:'project-1',kind:'name',label:'项目名称',value:'D项目'},
];
const field=(group:string,label:string,value='',section='教育经历')=>({group,label,value,section,type:'text'});
test('coverage starts from every confirmed source even with no rendered fields',()=>{
 const plan=recordCoverage(facts,[],new Set(['education','project']),new Map());
 assert.deepEqual(plan.map(item=>[item.record,item.state]),[['education-1','missing'],['education-2','missing'],['internship-1','not-exposed'],['project-1','missing']]);
 assert.equal(plan[0]!.sourceRecordId,'source-a');assert.equal(plan[0]!.sourceRevision,3);
});
test('a partial unique major reconciles its source; common dates alone cannot',()=>{
 assert.equal(matchExistingRecord([field('a','学校名称'),field('a','专业','数学')],facts),'education-2');
 assert.equal(matchExistingRecord([field('a','开始时间','2025-01')],facts),undefined);
 assert.equal(matchExistingRecord([field('a','学校名称','未知大学'),field('a','专业','数学')],facts),undefined);
});
test('duplicate identities are reported as ambiguous instead of counted as coverage',()=>{
 const plan=recordCoverage(facts,[field('a','学校名称','A大学'),field('b','学校名称','A大学')],new Set(['education']),new Map());
 assert.equal(plan[0]!.state,'ambiguous');assert.equal(plan[0]!.groups.length,2);
});
test('nonempty unidentified records never become empty or safe additions',()=>{
 const plan=recordCoverage(facts,[field('a','学校名称','未确认大学')],new Set(['education']),new Map());
 assert.equal(plan[0]!.state,'ambiguous');assert.equal(plan[1]!.state,'ambiguous');
});
test('unknown creation outcome blocks that family and leaves other sections available',()=>{
 const plan=recordCoverage(facts,[],new Set(['education','project']),new Map(),new Set(['education']));
 assert.equal(plan[0]!.state,'addition-unverified');assert.equal(plan[1]!.state,'addition-unverified');assert.equal(plan[3]!.state,'missing');
});
test('internship never supplies work-only fields or the no-work declaration',()=>{
 assert.equal(sectionMatchesRecord('internship','工作经历'),false);
 assert.equal(sectionMatchesRecord('internship','实习经历'),true);
 assert.equal(factFitsField(facts[4]!,field('a','公司名称','','工作经历')),false);
 assert.equal(factFitsField(facts[4]!,field('a','公司名称','','实习经历')),true);
 assert.equal(inferRecordSection([field('a','公司名称')]),'');
});
test('an explicit binding covers only that source while other source records stay required',()=>{
 const plan=recordCoverage(facts,[field('a','学校名称')],new Set(['education','project']),new Map([['a','education-1']]));
 assert.equal(plan[0]!.state,'matched');assert.equal(plan[1]!.state,'missing');assert.equal(plan[3]!.state,'missing');
});
test('direct fill and batched semantic select share the same failure limit',async()=>{
 const session:any=Object.create(UniversalFormSession.prototype),target={index:0,group:'a',identity:'b',label:'专业类别'};
 Object.assign(session,{view:{fields:[target]},fieldFailures:new Map(),lastFailures:new Map(),deferred:new Map(),actUnchecked:async()=>{throw Error('OWNED_OPTION_NOT_FOUND');},selectOptionUnchecked:async()=>{throw Error('OWNED_OPTION_NOT_FOUND');}});
 await assert.rejects(session.act({target:'field-0'}),/OWNED_OPTION_NOT_FOUND/);
 assert.equal(session.deferred.size,0);
 await assert.rejects(session.selectOption({target:'field-0'}),/OWNED_OPTION_NOT_FOUND/);
 assert.equal(session.deferred.get('a|b|专业类别'),'OWNED_OPTION_NOT_FOUND');
});
test('an answer confirmed for a different question cannot supply an unknown selector',()=>{
 const session:any=Object.create(UniversalFormSession.prototype);session.answerFor=()=>undefined;
 assert.equal(session.semanticMappingIssue({label:'上海',type:'combobox',ownedSelect:true},{kind:'answer',sourceRecordId:'another-question'}),'SCOPED_ANSWER_REQUIRED');
 assert.equal(session.semanticMappingIssue({label:'意向城市',type:'combobox',ownedSelect:true},{kind:'skills',record:'personal'}),'EXPLICIT_PREFERENCE_REQUIRED');
 assert.equal(session.semanticMappingIssue({label:'上海',type:'combobox',ownedSelect:true},{kind:'skills',record:'personal'}),'EXPLICIT_CAPABILITY_FACT_REQUIRED');
});
