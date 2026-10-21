import test from 'node:test';import assert from 'node:assert/strict';
import {matchExistingRecord,inferRecordSection} from '../packages/forms/src/record-binding.js';
import {applicationFacts,factFitsField} from '../packages/forms/src/application-facts.js';
import {overrideProfile as profile} from './fixtures/override-profile.js';
const facts=applicationFacts(profile);
const field=(label:string,value:string,section='项目经历')=>({label,value,section,type:'text'});
test('project identity tolerates parser spacing but shared dates or mixed descriptions cannot change identity',()=>{
 assert.equal(matchExistingRecord([field('项目名称','Demo Agent'),field('开始时间','2026-06'),field('结束时间','2026-08'),field('项目描述',profile.career!.projects[1]!.description)],facts),'project-1');
 assert.equal(matchExistingRecord([field('项目名称','Demo Agent Plus'),field('开始时间','2026-06'),field('结束时间','2026-08')],facts),undefined);
 assert.equal(matchExistingRecord([field('开始时间','2026-06'),field('结束时间','2026-08')],facts),undefined);
 assert.equal(matchExistingRecord([field('项目名称','DemoAgent'),field('项目名称','DemoRL')],facts),undefined);
});
test('education replacement needs unique school or two independent exact corroborating facts',()=>{
 assert.equal(matchExistingRecord([field('学校名称','解析错了','教育经历'),field('开始时间','2025-09','教育经历'),field('学历','硕士','教育经历')],facts),'education-1');
 assert.equal(matchExistingRecord([field('学历','硕士','教育经历')],facts),undefined);
});
test('college and school are separate; ranking cannot borrow major and blank college has no fact',()=>{
 const college=facts.find(f=>f.kind==='college')!,school=facts.find(f=>f.kind==='school')!,major=facts.find(f=>f.kind==='major')!;
 assert.ok(factFitsField(college,field('学院名称','','教育经历')));assert.equal(factFitsField(school,field('学院名称','','教育经历')),false);assert.equal(factFitsField(major,field('专业排名','','教育经历')),false);
 const copy=structuredClone(profile);copy.career!.educations[0]!.college='';assert.equal(applicationFacts(copy).filter(f=>f.record==='education-1'&&f.kind==='college').length,0);
 assert.equal(inferRecordSection([field('学校名称',''),field('学院名称','')]),'教育经历');assert.equal(inferRecordSection([field('职务','')]),'');assert.equal(inferRecordSection([field('项目名称',''),field('学校名称','')]),'');
});
test('description-only projects require a unique long source prefix and reject mixed or conflicting identities',()=>{
 const copy=structuredClone(profile);copy.career!.projects.forEach((record,index)=>record.description=('虚构研究方向'+index+'的独立实现描述，').repeat(20));const source=applicationFacts(copy),one=copy.career!.projects[0]!.description,two=copy.career!.projects[1]!.description;
 const prose=(value:string)=>({label:'项目描述',value,section:'项目经历',type:'textarea'});
 assert.equal(matchExistingRecord([prose('标题\n\n'+one)],source),'project-1');assert.equal(matchExistingRecord([prose(one+'\n'+two)],source),undefined);assert.equal(matchExistingRecord([field('项目名称','与真实项目无关的名称'),prose(one)],source),undefined);assert.equal(matchExistingRecord([prose(one),prose(two)],source),undefined);
});
