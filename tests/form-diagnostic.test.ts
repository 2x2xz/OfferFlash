import assert from 'node:assert/strict';
import test from 'node:test';
import { formDiagnostic } from '../packages/forms/src/form-diagnostic.js';
import type { Profile, FormObservation } from '../packages/shared/src/contracts.js';

test('local diagnostic projects structure without values, credentials, URLs or executable plans', () => {
  const profile:Profile={version:1,updatedAt:'',fullName:'虚构候选人',fullNameEn:'',email:'fixture@example.invalid',phone:'13800000000',school:'虚构大学',schoolEn:'',degree:'硕士',major:'计算机',majorEn:'',graduationMonth:'2027-06',skills:[],cities:[],targetRoles:[],resumeText:''};
  const observation:FormObservation={id:'private-observation',url:'https://example.invalid/form?token=PRIVATE_TOKEN',title:'',signature:'private-signature',observedAt:'',fields:[{id:'private-field',index:0,label:'姓名',type:'text',value:'网页已有私值',required:true,editable:true,options:[],bounds:{x:0,y:0,width:100,height:20},signature:'private-field-signature'}]};
  const before=structuredClone({profile,observation});
  const report=formDiagnostic(observation,profile,{controls:[{index:0,tag:'INPUT',type:'text',classes:['form-input','private123'],value:'DO_NOT_EXPORT',ancestors:[{depth:1,tag:'DIV',visibleControls:1,classes:['form-item'],labels:[{tag:'LABEL',text:'姓名 虚构候选人 网页已有私值 fixture@example.invalid 13800000000 https://example.invalid/secret'}]}]}]});
  const serialized=JSON.stringify(report);
  for(const value of ['虚构候选人','网页已有私值','fixture@example.invalid','13800000000','PRIVATE_TOKEN','private-field','private-observation','DO_NOT_EXPORT','private123','/secret'])assert.equal(serialized.includes(value),false,value);
  assert.equal(report.origin,'https://example.invalid');assert.equal(report.planRegistered,false);assert.equal(report.modelCalls,0);
  assert.equal(report.counts.observed,1);assert.deepEqual({profile,observation},before);
  assert.deepEqual(formDiagnostic(observation,profile,null).structure,[]);
});
