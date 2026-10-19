import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FEISHU_READ_HELPERS, READ_FEISHU_CAREER } from './feishu-scripts.js';
import { buildCareerPlan, careerGroupSignature, type CareerFieldKey, type CareerFormCollection, type CareerFormObservation } from '../../forms/src/career-plan.js';
import { prepareOneClickCareer } from '../../ui/src/one-click-career.js';
import type { CareerFillPreview } from '../../shared/src/career-form.js';
import type { Profile } from '../../shared/src/contracts.js';
import type { BackgroundDraftResult } from '../../domain/src/application-queue.js';
import {backgroundCareerOption,backgroundCareerPopupFingerprint,type BackgroundCareerActionRequest,type BackgroundCareerPopup} from './background-career-actions.js';

const collections: Record<string,CareerFormCollection>={education:'educations',internship:'internships',project:'projects'};
const keys:Record<string,CareerFieldKey>={school:'school',degree:'degree',fieldOfStudy:'major',company:'organization',title:'role',desc:'description',name:'name',role:'role',link:'url'};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Exact reviewed adapter snapshot. Coordinates may move, other observed state must match. */
export function backgroundCareerSnapshot(raw:unknown):string {
  return JSON.stringify(raw,(key,value)=>key==='bounds'?undefined:value);
}
export function backgroundCareerObservation(raw:any,generation:number):CareerFormObservation {
  if(!raw||raw.supported!==true||!Array.isArray(raw.groups)||raw.groups.length>90||!Array.isArray(raw.addControls)||!Array.isArray(raw.protectedControls))throw new Error('未识别的飞书表单结构。');
  const groups=raw.groups.map((group:any)=>{
    if(!collections[group.kind]||!group.id||!group.identity||!Array.isArray(group.fields)||group.fields.length>30)throw new Error('经历组身份无效。');
    const fields=group.fields.map((field:any)=>{
      const key=field.property==='period'?field.side==='start'?'startDate':field.side==='end'?'endDate':undefined:keys[field.property];
      if(!key||!field.fieldId||!field.identity||typeof field.value!=='string'||field.value.length>20000||typeof field.editable!=='boolean')throw new Error('经历字段身份无效。');
      const type=field.type==='feishu-single-select'?'combobox':field.type;
      return {id:field.fieldId,key:key as CareerFieldKey,type,value:field.value,editable:field.editable,
        signature:hash([field.fieldId,field.identity,type,field.editable,field.required]),
        ...(field.required===undefined?{}:{required:field.required}),
        ...(type==='feishu-month'?{datePrecision:'month' as const}:{}),
        ...(type==='feishu-month'&&field.side==='end'&&field.supportsUntilNow===true?{supportsUntilNow:true}:{}),
        ...(type==='combobox'?{customSelectSupported:true}:{})};
    });
    const value={id:group.id,collection:collections[group.kind]!,fields};return {...value,signature:careerGroupSignature(value)};
  });
  const addControls=raw.addControls.map((control:any)=>({id:control.id,collection:collections[control.kind]!,signature:hash(control.identity),enabled:control.enabled===true}));
  const protectedFields=raw.protectedControls.map((control:any,index:number)=>({id:`protected-${index}`,signature:hash([control.identity,control.disabled,control.readOnly,control.sensitive]),
    value:typeof control.value==='string'?control.value+(control.files||control.selectedLabels||control.ariaValueText!==undefined?'|metadata:'+hash([control.files,control.selectedLabels,control.ariaValueText]):''):'',checked:control.checked===true}));
  return {id:randomUUID(),url:raw.url,generation,groups,addControls,protectedFields,signature:hash([groups.map((group:any)=>group.signature),addControls,protectedFields.map((field:any)=>field.signature)])};
}
export function backgroundCareerWriteScript(input:{url:string;fieldId:string;value:string;expectedSnapshot:string}, scope?:{read:string;helpers:string}):string {
  if(scope&&!process.argv.includes('--smoke-test'))throw new Error('隔离作用域仅供显式桌面样表验收。');
  if(!/^(education|internship|project)\[(0|[1-9]\d{0,5})\]\.(fieldOfStudy|company|title|desc|name|role|link)$/.test(input.fieldId)
    ||!input.value||input.value.length>20000||input.expectedSnapshot.length>4_000_000)throw new Error('后台经历字段无效。');
  return String.raw`(()=>{
    const input=${JSON.stringify(input).replace(/</g,'\\u003c')};
    const current=${scope?.read??READ_FEISHU_CAREER};
    const stable=JSON.stringify(current,(key,value)=>key==='bounds'?undefined:value);
    if(current.url!==input.url||!current.supported||stable!==input.expectedSnapshot)return {status:'stale'};
    ${scope?.helpers??FEISHU_READ_HELPERS}
    const located=fsLocate(input.fieldId);
    if(!located||!['text','textarea','url'].includes(located.field.type)||!located.field.editable||located.field.value.trim())return {status:'unsupported'};
    const target=located.element;
    if(!['INPUT','TEXTAREA'].includes(target.tagName)||target.readOnly||target.disabled||target.closest('[role="combobox"],[contenteditable],[inert]'))return {status:'unsupported'};
    if(target.maxLength>=0&&input.value.length>target.maxLength)return {status:'unsupported'};
    const setter=Object.getOwnPropertyDescriptor(target.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;
    if(!setter)return {status:'unsupported'};
    setter.call(target,input.value);target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
    return {status:'written'};
  })()`;
}
export interface BackgroundCareerTransport {
  read():Promise<any>;write(input:{url:string;fieldId:string;value:string;expectedSnapshot:string}):Promise<{status:string}>;
  getProfile():Promise<Profile>;getURL():string;getGeneration():number;settle?(ms:number):Promise<void>;
  action?(input:BackgroundCareerActionRequest):Promise<{status:string}>;
  popup?(fieldId:string,type:'combobox'|'feishu-month'):Promise<BackgroundCareerPopup|null>;
}
export async function runBackgroundCareerFill(transport:BackgroundCareerTransport,approvedProfile:Profile,signal:AbortSignal,
  progress:(verified:number,pending:number)=>void):Promise<BackgroundDraftResult> {
  const profile=structuredClone(approvedProfile),url=transport.getURL(),generation=transport.getGeneration();
  const guard=async()=>{
    if(signal.aborted||transport.getURL()!==url||transport.getGeneration()!==generation||(await transport.getProfile()).version!==profile.version)throw new Error('后台经历资料或网页已变化。');
    if(signal.aborted||transport.getURL()!==url||transport.getGeneration()!==generation)throw new Error('读取资料期间后台页面已变化。');
  };
  await guard();let raw=await transport.read();if(!raw?.supported)return {verifiedCount:0,pendingCount:0,message:'此页不是已审阅的飞书经历表',canReview:true};
  const original=backgroundCareerObservation(raw,generation);
  const preview:CareerFillPreview={planId:'background-observation',url,profileVersion:profile.version,groups:original.groups,bindings:[],selectedRecordIds:{},preserveGroupIds:[],steps:[],issues:[]};
  const automatic=prepareOneClickCareer(profile,preview);
  if(automatic.status!=='ready')return {verifiedCount:0,pendingCount:Math.max(1,original.groups.length),message:'经历对应关系需你确认，后台不猜测或新增',canReview:true};
  // Empty groups with multiple possible records need an explicit foreground choice.
  const ambiguousEmpty=original.groups.filter(group=>group.fields.every(field=>!field.value.trim())
    &&(automatic.options.selectedRecordIds?.[group.collection]?.length??0)>1);
  if(ambiguousEmpty.length)return {verifiedCount:0,pendingCount:ambiguousEmpty.length,message:'空白经历组存在多条候选，请在前台确认对应关系',canReview:true};
  const plan=buildCareerPlan(profile,original,automatic.options);let verifiedCount=0,pendingCount=plan.issues.length;
  const wait=(ms:number)=>transport.settle?transport.settle(ms):delay(ms,undefined,{signal});
  const fillComplex=async(item:{fieldId:string;value:string},type:'combobox'|'feishu-month'):Promise<boolean>=>{
    if(!transport.action||!transport.popup)return false;
    await guard();let baseline=backgroundCareerSnapshot(raw);
    if((await transport.action({url,fieldId:item.fieldId,action:'open',expectedSnapshot:baseline})).status!=='open')return false;
    await wait(80);await guard();
    let observed=await transport.read();
    if(backgroundCareerSnapshot(observed)!==baseline)throw new Error('展开控件时其它字段或原值变化。');
    const present=item.value==='至今',date=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(item.value);
    if(type==='feishu-month'&&!present&&!date)return false;
    const phases=type==='combobox'?[{action:'select' as const,value:item.value}]:present?[{action:'year' as const,value:'至今'}]
      :[{action:'year' as const,value:date![1]!},{action:'month' as const,value:date![2]!}];
    for(const phase of phases){
      await guard();let popup=await transport.popup(item.fieldId,type);
      if(!popup)return false;
      const frozen=backgroundCareerPopupFingerprint(popup);await wait(80);await guard();
      const second=await transport.popup(item.fieldId,type);
      if(!second||backgroundCareerPopupFingerprint(second)!==frozen)return false;popup=second;
      const option=backgroundCareerOption(popup,phase.action,phase.value);if(!option)return false;
      const before=await transport.read();await guard();
      if(backgroundCareerSnapshot(before)!==baseline)throw new Error('选择前经历或其它控件已变化。');
      const result=await transport.action({url,fieldId:item.fieldId,action:phase.action,value:option.value,
        popupIdentity:popup.identity,optionIdentity:option.identity,popupFingerprint:frozen,expectedSnapshot:baseline});
      if(result.status!=='selected')return false;
      const expected=structuredClone(raw),target=expected.groups.flatMap((group:any)=>group.fields).find((field:any)=>field.fieldId===item.fieldId);
      if(type==='combobox')target.value=option.value;
      else if(present){target.value='至今';target.year='';target.month='';target.untilNow=true;}
      else if(phase.action==='year'){target.value=phase.value+'-MM';target.year=phase.value;target.month='MM';}
      else{target.value=item.value;target.year=date![1]!;target.month=date![2]!;}
      await wait(100);await guard();observed=await transport.read();
      if(backgroundCareerSnapshot(observed)!==backgroundCareerSnapshot(expected))throw new Error('控件选择结果与已确认值不一致。');
      raw=observed;baseline=backgroundCareerSnapshot(raw);
    }
    await wait(180);await guard();
    const stable=await transport.read();if(backgroundCareerSnapshot(stable)!==baseline)throw new Error('控件选择未稳定保留。');
    raw=stable;return true;
  };
  for(const step of plan.steps){
    if(step.kind==='add-then-reobserve'){pendingCount++;continue;}
    for(const item of step.items){
      if(item.status==='review'){pendingCount++;continue;}if(item.status!=='ready')continue;
      const field=original.groups.find(group=>group.id===step.binding.groupId)?.fields.find(field=>field.id===item.fieldId);
      if(!field){pendingCount++;continue;}
      if(field.type==='combobox'||field.type==='feishu-month'){
        if(await fillComplex(item,field.type)){verifiedCount++;progress(verifiedCount,pendingCount);}else pendingCount++;
        continue;
      }
      if(!['text','textarea','url'].includes(field.type)||field.key==='school'){pendingCount++;continue;}
      await guard();const before=backgroundCareerSnapshot(raw),fresh=await transport.read();await guard();
      if(backgroundCareerSnapshot(fresh)!==before)throw new Error('后台经历或其它控件已变化。');
      const result=await transport.write({url,fieldId:item.fieldId,value:item.value,expectedSnapshot:before});
      if(result.status!=='written'){pendingCount++;continue;}
      await wait(100);await guard();const after=await transport.read();
      const expected=structuredClone(raw),target=expected.groups.flatMap((group:any)=>group.fields).find((field:any)=>field.fieldId===item.fieldId);
      if(!target)throw new Error('经历字段已消失。');target.value=item.value;
      if(backgroundCareerSnapshot(after)!==backgroundCareerSnapshot(expected))throw new Error('经历输入未独立核对，不重复写入。');
      await wait(180);await guard();const stable=await transport.read();
      if(backgroundCareerSnapshot(stable)!==backgroundCareerSnapshot(expected))throw new Error('经历值未稳定保留。');
      raw=stable;verifiedCount++;progress(verifiedCount,pendingCount);
    }
  }
  await guard();return {verifiedCount,pendingCount,canReview:true,message:`后台核对 ${verifiedCount} 项已适配经历字段；未支持或缺资料的项目仍需你处理`};
}
