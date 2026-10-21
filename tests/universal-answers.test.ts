import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeAnswerQuestion} from '../packages/domain/src/application-assets.js';
import{universalQuestion,eligibleUniversalAnswers,universalAnswerMatches}from'../packages/forms/src/universal-answers.js';import{applicationFacts}from'../packages/forms/src/application-facts.js';import{profile}from'./fixtures/moka-form.js';import type{ConfirmedAnswer}from'../packages/shared/src/application-assets.js';
const facts=applicationFacts(profile),gpa={label:'GPA/CGPA',section:'教育经历',type:'text',value:'',editable:true},url='https://example.invalid/job/1';
test('memory keys separate education records; unknown record, sensitive questions and navigation are not answer prompts',()=>{
 const a=universalQuestion(gpa,url,'education-1',facts)!,b=universalQuestion(gpa,url,'education-2',facts)!;assert.notEqual(a.key,b.key);assert.equal(universalQuestion(gpa,url,undefined,facts),undefined);
 for(const label of ['身份证号','是否需要香港工作签证','性别 / Gender','Keyword'])assert.equal(universalQuestion({...gpa,label,section:''},url,undefined,facts),undefined,label);
});
test('only current confirmed scoped ordinary answers are reusable',()=>{
 const q=universalQuestion(gpa,url,'education-1',facts)!;const answer:ConfirmedAnswer={id:'fixture',revision:2,createdAt:'',updatedAt:'',questionPattern:q.key,answer:'3.8/4.0',scope:{kind:'general'},risk:'ordinary',demo:false,confirmedAt:'2026-10-20',confirmedRevision:2,confirmedProfileVersion:profile.version};
 assert.equal(eligibleUniversalAnswers({answers:[answer]},profile.version).length,1);assert.equal(universalAnswerMatches(answer,q,gpa),true);
 for(const change of [{confirmedRevision:null},{confirmedProfileVersion:999},{risk:'high-impact' as const},{scope:{kind:'application' as const,applicationId:'other'}},{demo:true}])assert.equal(eligibleUniversalAnswers({answers:[{...answer,...change}]},profile.version).length,0);
 assert.equal(universalAnswerMatches({...answer,questionPattern:'GPA/CGPA'},q,gpa),false);
});
test('unknown company questions stay within their job; ordinary stable facts can match the next job',()=>{
 const field={...gpa,label:'为什么希望加入本公司',section:''},next='https://example.invalid/job/2';assert.notEqual(universalQuestion(field,url,undefined,facts)!.key,universalQuestion(field,next,undefined,facts)!.key);
 const location={...field,label:'所在地 / Location'};assert.equal(universalQuestion(location,url,undefined,facts)!.key,universalQuestion(location,next,undefined,facts)!.key);
});

test('personal answers keep the same identity across sites and presentation section names',()=>{
 for(const label of ['兴趣爱好','特长','自我评价','常用工具','technical skills']){
  const first=universalQuestion({...gpa,label,section:'个人信息'},url,undefined,facts)!;
  const next=universalQuestion({...gpa,label,section:'补充信息'},'https://other.invalid/application/9',undefined,facts)!;
  assert.equal(first.key,next.key,label);assert.equal(next.context,'相同问题可复用');
 }
 const contextual={...gpa,label:'自我评价：为什么适合本公司',section:''};
 assert.notEqual(universalQuestion(contextual,url,undefined,facts)!.key,universalQuestion(contextual,'https://other.invalid/job/2',undefined,facts)!.key);
});
test('legacy exact memory remains readable without allowing another education or company answer',()=>{
 const field={...gpa,label:'所在地 / Location',section:'基本信息'},q=universalQuestion(field,url,undefined,facts)!;
 assert.ok(q.legacyKeys?.length);
 const answer={questionPattern:q.legacyKeys![0]} as ConfirmedAnswer;
 assert.equal(universalAnswerMatches(answer,q,field),true);
 assert.equal(universalAnswerMatches(answer,universalQuestion(gpa,url,'education-1',facts)!,gpa),false);
});
test('an unfamiliar ordinary personal question can be explicitly remembered across websites',()=>{
 const field={...gpa,label:'是否接受出差',section:'其它信息'};
 const first=universalQuestion(field,url,undefined,facts)!,next=universalQuestion({...field,section:'附加资料'},'https://another.invalid/application',undefined,facts)!;
 assert.ok(first.reusableKey);assert.notEqual(first.key,next.key);assert.equal(first.reusableKey,next.reusableKey);
 assert.equal(universalAnswerMatches({questionPattern:first.reusableKey} as ConfirmedAnswer,next,field),true);
 const company=universalQuestion({...field,label:'为什么希望加入本公司'},url,undefined,facts)!;assert.equal(company.reusableKey,undefined);
});

test('personal-looking prefixes do not make employer or job questions reusable',()=>{
 for(const label of ['自我评价：为什么适合此职位','个人优势：如何服务企业','常用工具：本岗位要求','personal strengths for this job','自我评价：针对这份工作']){
  const field={...gpa,label,section:'个人信息'},first=universalQuestion(field,url,undefined,facts)!,next=universalQuestion(field,'https://other.invalid/application',undefined,facts)!;
  assert.notEqual(first.key,next.key,label);
 }
 for(const label of ['自我评价：为什么适合此职位','个人优势：如何服务企业','personal strengths for this job'])assert.equal(universalQuestion({...gpa,label,section:''},url,undefined,facts)!.reusableKey,undefined,label);
 const bilingual={...gpa,label:'所在地 / Location',section:'个人信息'};
 assert.equal(universalQuestion(bilingual,url,undefined,facts)!.key,universalQuestion({...bilingual,section:'附加资料'},'https://other.invalid',undefined,facts)!.key);
});

test('record-bound learning-mode answers keep their previously confirmed identity',()=>{
 for(const record of ['education-1','education-2']){
  const field={...gpa,label:'学习形式'},identity=facts.find(f=>f.record===record&&f.sourceRecordId)?.sourceRecordId,name=facts.find(f=>f.record===record&&f.kind==='school')?.value;
  const previous='[OfferFlash:'+createHash('sha256').update(JSON.stringify({context:{recordId:identity??record,school:name},section:field.section,question:normalizeAnswerQuestion(field.label)})).digest('hex').slice(0,32)+'] '+field.label;
  const current=universalQuestion(field,url,record,facts)!;assert.equal(current.key,previous);assert.equal(current.reusableKey,undefined);
 }
});
