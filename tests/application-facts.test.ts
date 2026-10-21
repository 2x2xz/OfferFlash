import test from 'node:test';import assert from 'node:assert/strict';
import{applicationFacts,factFitsField,optionMatchesFact}from'../packages/forms/src/application-facts.js';
import type{Profile}from'../packages/shared/src/contracts.js';
const profile:Profile={version:1,updatedAt:'',fullName:'虚构人',fullNameEn:'Fictional Candidate',email:'fixture@example.invalid',phone:'13800000000',school:'虚构大学',schoolEn:'',degree:'硕士',major:'计算机',majorEn:'',graduationMonth:'2027-06',skills:[],cities:[],targetRoles:[],resumeText:''};
test('facts expose only supported confirmed values with opaque references',()=>{const facts=applicationFacts(profile);assert.equal(facts.find(f=>f.kind==='fullName')?.value,'虚构人');assert.ok(facts.every(f=>/^fact-\d+$/.test(f.ref)));assert.ok(!facts.some(f=>f.kind==='resumeText'));});
test('fact bindings require semantic field and matching career section',()=>{const facts=applicationFacts(profile),school=facts.find(f=>f.kind==='school')!,name=facts.find(f=>f.kind==='fullName')!;
 assert.equal(factFitsField(school,{label:'学校名称',section:'教育经历',type:'text'}),true);assert.equal(factFitsField(school,{label:'公司名称',section:'实习经历',type:'text'}),false);
 for(const label of ['紧急联系人姓名','公司名称','First name','Last name','Preferred name','如果不适用请填写姓名','English name','Current manager name'])assert.equal(factFitsField(name,{label,type:'text'}),false,label);
 assert.equal(factFitsField(name,{label:'Name *',type:'text'}),true);
});
test('dropdown equivalence is exact or narrow degree alias, never substring guessing',()=>{assert.equal(optionMatchesFact('硕士研究生','硕士'),true);assert.equal(optionMatchesFact('本科及以上','本科'),false);assert.equal(optionMatchesFact('硕士及以上','硕士'),false);});
test('summary education cannot answer onboarding dates or bind a career record',()=>{
 const graduation={ref:'summary',record:'summary',kind:'endDate',label:'默认教育毕业年月',value:'2027-06'},degree={...graduation,kind:'degree',value:'硕士'};
 assert.equal(factFitsField(graduation,{label:'毕业时间 / Graduation date · 年',type:'combobox'}),true);
 for(const label of ['到岗时间 / Onboarding time','结束时间','入职时间'])assert.equal(factFitsField(graduation,{label,type:'combobox'}),false);
 assert.equal(factFitsField(graduation,{label:'毕业时间',section:'教育经历',type:'combobox'}),false);
 assert.equal(factFitsField(degree,{label:'最高学历 / Highest Degree',type:'combobox'}),true);
 assert.equal(factFitsField(degree,{label:'学历',section:'教育经历',type:'combobox'}),false);
});
