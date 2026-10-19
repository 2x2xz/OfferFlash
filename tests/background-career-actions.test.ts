import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundCareerActionScript,backgroundCareerOption,backgroundCareerPopupFingerprint } from '../packages/browser/src/background-career-actions.js';

const request={url:'https://modelbest.jobs.feishu.cn/fixture',fieldId:'internship[0].period:end',expectedSnapshot:'{}',action:'year' as const,value:'至今',popupIdentity:'popup',optionIdentity:'year-option',popupFingerprint:'fingerprint'};
test('background until-now action is restricted to reviewed internship/project end-year only',()=>{
  assert.ok(backgroundCareerActionScript(request));
  for(const fieldId of ['education[0].period:end','internship[0].period:start','internship[0].title','button[type=submit]'])assert.throws(()=>backgroundCareerActionScript({...request,fieldId}));
  assert.throws(()=>backgroundCareerActionScript({...request,action:'month'}));
  for(const value of ['202X','0000','2026-06'])assert.throws(()=>backgroundCareerActionScript({...request,value}));
});
test('background popup phases require exact snapshot, popup/option identities and full option fingerprint',()=>{
  const script=backgroundCareerActionScript(request);
  for(const key of ['expectedSnapshot','popupIdentity','optionIdentity','popupFingerprint'])assert.match(script,new RegExp(key));
  assert.match(script,/fsMonthPopup/);assert.match(script,/getAttribute\('data-cy'\)!=='-'/);
  assert.ok(!/sendInputEvent|insertText|\.submit\(|requestSubmit\(|\.focus\(/.test(script));
  assert.throws(()=>backgroundCareerActionScript({...request,popupFingerprint:''}));
});
test('degree selection uses unique true degree equivalence; duplicate or unknown labels remain manual',()=>{
  const popup={identity:'degree-popup',options:[{identity:'one',label:'本科',selected:false},{identity:'two',label:'硕士',selected:false}]};
  assert.deepEqual(backgroundCareerOption(popup,'select','Master'),{value:'硕士',identity:'two'});
  assert.equal(backgroundCareerOption({...popup,options:[...popup.options,{identity:'three',label:'硕士',selected:false}]},'select','硕士'),undefined);
  assert.equal(backgroundCareerOption(popup,'select','高级工程师'),undefined);
});
test('year/month options are unique within the bound column and fingerprint catches changed selection or options',()=>{
  const popup={identity:'month-popup',columns:[{kind:'year',options:[{identity:'present',value:'至今',selected:false},{identity:'year',value:'2026',selected:false}]},{kind:'month',options:[{identity:'month',value:'06',selected:false}]}]};
  assert.deepEqual(backgroundCareerOption(popup,'year','至今'),{value:'至今',identity:'present'});
  assert.equal(backgroundCareerOption(popup,'month','至今'),undefined);
  const before=backgroundCareerPopupFingerprint(popup);popup.columns[0]!.options[0]!.selected=true;
  assert.notEqual(backgroundCareerPopupFingerprint(popup),before);
  popup.columns[0]!.options.push({identity:'second-present',value:'至今',selected:false});
  assert.equal(backgroundCareerOption(popup,'year','至今'),undefined);
});
