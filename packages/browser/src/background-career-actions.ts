import { FEISHU_READ_HELPERS } from './feishu-scripts.js';
import { matchSelectOption } from '../../forms/src/index.js';

export type BackgroundCareerAction = 'open'|'select'|'year'|'month';
export interface BackgroundCareerActionRequest {
  url:string;fieldId:string;expectedSnapshot:string;action:BackgroundCareerAction;value?:string;
  popupIdentity?:string;optionIdentity?:string;
  popupFingerprint?:string;
}
/** Entirely host-authored phases; no arbitrary selectors or handler code enter the API. */
export function backgroundCareerActionScript(input:BackgroundCareerActionRequest, helpers=FEISHU_READ_HELPERS):string {
  if(helpers!==FEISHU_READ_HELPERS&&!process.argv.includes('--smoke-test'))throw new Error('隔离控件作用域仅供显式桌面样表验收。');
  const match=/^(education|internship|project)\[(0|[1-9]\d{0,5})\]\.(degree|period(?::(?:start|end)))$/.exec(input.fieldId);
  if(!match||!['open','select','year','month'].includes(input.action)||!input.expectedSnapshot||input.expectedSnapshot.length>4_000_000)throw new Error('后台控件动作无效。');
  if(match[3]==='degree'&&!['open','select'].includes(input.action)||match[3]!=='degree'&&input.action==='select')throw new Error('控件与动作类别不符。');
  if(input.action!=='open'&&(!input.value||!input.popupIdentity||!input.optionIdentity||!input.popupFingerprint))throw new Error('后台选项授权无效。');
  if(input.value==='至今'&&(!input.fieldId.endsWith(':end')||match[1]==='education'||input.action!=='year'))throw new Error('此端点不能选择至今。');
  if(input.action==='year'&&input.value!=='至今'&&(!/^\d{4}$/.test(input.value!)||Number(input.value)<1)
    ||input.action==='month'&&!/^(?:0[1-9]|1[0-2])$/.test(input.value!)
    ||input.action==='select'&&input.value!.length>240)throw new Error('后台选项值无效。');
  return String.raw`(()=>{
    const input=${JSON.stringify(input).replace(/</g,'\\u003c')};
    ${helpers}
    const current=fsObserve();
    if(current.url!==input.url||!current.supported||JSON.stringify(current,(key,value)=>key==='bounds'?undefined:value)!==input.expectedSnapshot)return {status:'stale'};
    const located=fsLocate(input.fieldId);if(!located||!located.field.editable)return {status:'unsupported'};
    if(input.action==='open'){
      if(located.field.value.trim())return {status:'nonempty'};
      if(!['feishu-single-select','feishu-month'].includes(located.field.type))return {status:'unsupported'};
      const open=located.field.type==='feishu-single-select'?fsSelectPopup(located.field.path):fsMonthPopup(located.field.path,located.field.side);
      if(open)return {status:'open'};
      if(located.element.tagName!=='DIV'||fsDangerousAncestor(located.element,located.wrapper))return {status:'unsupported'};
      HTMLElement.prototype.click.call(located.element);return {status:'open'};
    }
    const selected=input.action==='select';
    const popup=selected?fsSelectPopup(located.field.path):fsMonthPopup(located.field.path,located.field.side);
    if(!popup||popup.identity!==input.popupIdentity)return {status:'stale'};
    const fingerprint=JSON.stringify(selected?[popup.identity,popup.entries.map(entry=>[entry.identity,entry.label,entry.selected])]
      :[popup.identity,popup.columns.map(column=>[column.kind,column.entries.map(entry=>[entry.identity,entry.value,entry.selected])])]);
    if(fingerprint!==input.popupFingerprint)return {status:'stale'};
    const entries=selected?popup.entries:popup.columns.find(column=>column.kind===input.action)?.entries;
    if(!entries)return {status:'unsupported'};
    const found=entries.filter(option=>option.identity===input.optionIdentity&&(selected?option.label:option.value)===input.value);
    if(found.length!==1)return {status:'unsupported'};
    const option=found[0];
    if(input.value==='至今'&&(located.field.side!=='end'||located.field.supportsUntilNow!==true||!['internship','project'].includes(located.field.kind)
      ||option.element.getAttribute('data-cy')!=='-'||option.element.tagName!=='DIV'||fsText(option.element.textContent)!=='至今'))return {status:'unsupported'};
    if(selected&&located.field.value.trim()||!selected&&!(located.field.value===''||/^\d{4}-MM$/.test(located.field.value)))return {status:'nonempty'};
    HTMLElement.prototype.click.call(option.element);return {status:'selected'};
  })()`;
}
export interface BackgroundCareerPopup {identity:string;options?:Array<{label:string;identity:string;selected?:boolean}>;columns?:Array<{kind:string;options:Array<{value:string;identity:string;selected?:boolean}>}>;}
export function backgroundCareerPopupFingerprint(popup:BackgroundCareerPopup):string{
  return JSON.stringify(popup.options?[popup.identity,popup.options.map(entry=>[entry.identity,entry.label,entry.selected])]
    :[popup.identity,popup.columns?.map(column=>[column.kind,column.options.map(entry=>[entry.identity,entry.value,entry.selected])])]);
}
export function backgroundCareerOption(popup:BackgroundCareerPopup,action:'select'|'year'|'month',value:string):{value:string;identity:string}|undefined {
  if(action==='select'){
    const option=matchSelectOption(value,(popup.options??[]).map(option=>({label:option.label,value:option.label})),'degree');
    const found=popup.options?.filter(entry=>entry.label===option?.value)??[];return found.length===1?{value:found[0]!.label,identity:found[0]!.identity}:undefined;
  }
  const columns=popup.columns?.filter(column=>column.kind===action)??[];
  const found=columns.length===1?columns[0]!.options.filter(option=>option.value===value):[];
  return found.length===1?{value,identity:found[0]!.identity}:undefined;
}
